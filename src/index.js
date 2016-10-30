/**
 * # Closure Eliminator
 */

// Do not use Symbol here. class constructor/body missed Symbol-props
const $classConstructor = '__classConstructor';
const $classMethod = '__classMethod';
const $objectMethod = '__objectMethod';
const $bindedArrowFunction = '__bindedArrowFunction';

export default function build(babel:Object):Object {
  const {types: t} = babel;

  return {
    visitor: {
      Function: {
        exit (path) {
          const {node} = path;
          if (node[$classConstructor] || node.body[$classConstructor] || node[$classMethod] || node[$objectMethod] || node[$bindedArrowFunction]) {
            return;
          }
          if (path.findParent(({node}) => node._generated || node._compact)) {
            path.skip();
            return;
          }
          const bestParentScope = getBestHoistedScope(path);
          if (bestParentScope !== path.scope.parent) {
            const attachPath = getAttachmentPosition(bestParentScope.path, path);
            moveToNewPosition(path, attachPath);
          }
        }
      },
      ObjectExpression: {
        enter(path) {
          path.traverse({
            ObjectMethod: {
              enter({node}) {
                node[$objectMethod] = node.body[$objectMethod] = true;
              }
            }
          });
        }
      },
      Class: {
        enter(path) {
          const node = path.node;
          node[$classConstructor] = node.body[$classConstructor] = true;
          path.traverse({
            ClassMethod: {
              enter({node}) {
                node[$classMethod] = node.body[$classMethod] = true;
              }
            }
          });
        }
      },
      ThisExpression: {
        enter(path) {
          var parentArrow = path;
          while (parentArrow = parentArrow.findParent(node=>node.type === 'ArrowFunctionExpression')) {
            parentArrow.node[$bindedArrowFunction] = true;
          }
        }
      }
    }
  };

  function getBestHoistedScope(path) {
    const parentScopes = getAllParentScopes(path.scope),
      parentBindings = path.scope.parent.getAllBindings();
    for (let id in parentBindings) {
      let hasUsageOfBinding = []
        .concat(parentBindings[id].referencePaths)
        .concat(parentBindings[id].constantViolations)
        .some(subPath => subPath.getAncestry().indexOf(path) !== -1);
      if (hasUsageOfBinding) {
        let idx = parentScopes.indexOf(parentBindings[id].scope);
        if (idx !== -1) {
          parentScopes.splice(idx + 1, Infinity);
        }
      }
    }
    return parentScopes.pop();
  }

  function getAllParentScopes(scope) {
    var scopes = [];
    while (scope = scope.parent) {
      scopes.push(scope);
    }
    return scopes;
  }

  function getAttachmentPosition(bestParent, prevPath) {
    let possibleSiblings;
    if (bestParent.isFunction()) {
      possibleSiblings = bestParent.get('body.body');
    } else if (bestParent.isProgram() || bestParent.isBlockStatement()) {
      possibleSiblings = bestParent.get('body');
    }
    const prevParents = prevPath.getAncestry();
    return possibleSiblings.find(x => prevParents.indexOf(x) !== -1);
  }

  function moveToNewPosition(path, attachPath) {
    const {node, scope} = path,
      newScope = attachPath.parentPath.scope;
    if (node.type === 'FunctionDeclaration') {
      let uid = newScope.generateUidIdentifierBasedOnNode(node.id);
      scope.rename(node.id.name, uid.name);
      scope.moveBindingTo(uid.name, newScope);
      node._hoisted = true;
      attachPath.insertBefore([node]);
      path.remove();
    } else {
      const uid = path.parentPath.scope.generateUidIdentifierBasedOnNode(node.id),
        replacement = t.functionDeclaration(
          uid,
          node.params,
          normalizeFunctionBody(node.body)
        );
      replacement.loc = node.loc;
      replacement.generator = node.generator;
      replacement.async = node.async;
      replacement._hoisted = true;
      attachPath.insertBefore([replacement]);
      path.replaceWith(t.identifier(uid.name));
      newScope.crawl();
    }
  }

  /**
   * Normalize a function body so that it is always a BlockStatement.
   */
  function normalizeFunctionBody(node:Object):Object {
    if (node.type !== 'BlockStatement') {
      return t.blockStatement([
        t.returnStatement(node)
      ]);
    }
    else {
      return node;
    }
  }
}
