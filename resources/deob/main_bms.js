
//  用法：node main_bms.js [输入文件] [输出文件]
//  Akamai BMS（带 ?v= 的版本脚本）适配版。与 main.js 同家族混淆，差异见 bypass / restore。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const types = require('@babel/types');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const template = require('@babel/template').default;

let bmsOriginalIifeSource = null;

// ============================================================================
//  通用工具 (原 src/utils/common-utils.js)
// ============================================================================

// 判断节点是否纯净（无副作用且可以安全删除）
// 包含：字面量、标识符、this、以及递归的基础一元表达式（如 -1, +1, !0, void 0）
const isPureNode = (node) => {
    if (types.isLiteral(node)) return true;
    if (types.isIdentifier(node)) return true;
    if (types.isThisExpression(node)) return true;

    // 一元表达式：操作符安全且参数纯净时整体纯净（例如 -43, !0, void 0, +1）
    if (types.isUnaryExpression(node)) {
        return ["-", "+", "!", "void", "typeof"].includes(node.operator) &&
            isPureNode(node.argument);
    }
    return false;
};

/**
 * 计算最终保存路径
 * @param {string} inputPath - 输入文件路径
 * @param {string|boolean|undefined} outputConfig - 输出配置（路径/true/undefined）
 * @returns {string} 最终保存路径
 */
function getSavePath(inputPath, outputConfig) {
    const fileName = path.basename(inputPath);
    const inputDir = path.dirname(inputPath);

    if (typeof outputConfig === 'string') {
        return path.resolve(outputConfig);
    } else if (outputConfig === true) {
        return inputPath;
    } else {
        const distDir = path.resolve(inputDir, 'dist');
        if (!fs.existsSync(distDir)) {
            fs.mkdirSync(distDir, {recursive: true});
        }
        return path.resolve(distDir, fileName);
    }
}

/**
 * 保存文件（处理写入错误）
 * @param {string} savePath - 保存路径
 * @param {string} content - 要保存的内容
 */
function saveFile(savePath, content) {
    try {
        fs.writeFileSync(savePath, content, 'utf-8');
    } catch (error) {
        throw new Error(`文件保存失败：${error.message}（路径：${savePath}）`);
    }
}

// ============================================================================
//  执行引擎 (原 src/utils/babel-utils.js)
// ============================================================================

// ----------------------------- 日志控制工具 -----------------------------
const Logger = {
    originalLog: console.log,
    config: {
        tool: true,   // 是否打印工具自身的进度日志
        plugin: true  // 是否允许插件内部的 console.log 输出
    },
    savedConfig: null,
    init: function (userConfig) {
        this.savedConfig = this.config;
        this.config = {...this.config, ...userConfig};
        // 不允许插件打印时，劫持全局 console.log
        if (!this.config.plugin) {
            console.log = () => {
            };
        }
    },
    info: function (...args) {
        if (this.config.tool) {
            // 必须调用 originalLog，因为 console.log 可能已被劫持为空函数
            this.originalLog.apply(console, args);
        }
    },
    restore: function () {
        console.log = this.originalLog;
        if (this.savedConfig) {
            this.config = this.savedConfig;
            this.savedConfig = null;
        }
    }
};

/**
 * @typedef {Object} PluginItem
 * @property {string} name
 * @property {Object} visitor
 * @property {boolean} [needReparse]
 */

function runPlugin(ast, plugin, generatorOpts) {
    let currentAst = ast;

    /** @type {PluginItem[]} */
    const visitorQueue = Array.isArray(plugin.visitor)
        ? plugin.visitor
        : [{
            name: plugin.name,
            visitor: plugin.visitor,
            needReparse: plugin.needReparse
        }];

    for (const item of visitorQueue) {
        traverse(currentAst, item.visitor, null, {rootAst: currentAst});

        if (item.needReparse) {
            console.log(`[${item.name}] 触发重解析 AST...`);
            const code = generator(currentAst, generatorOpts).code;
            currentAst = parser.parse(code, generatorOpts);
        }
    }

    return currentAst;
}

/**
 * AST 迭代阶段（支持中间重解析 + 循环终止条件）
 */
function transformAstWithIteration(
    ast,
    pluginGroups,
    parserOpts = {},
    generatorOpts = {},
    terminateCondition
) {
    const defaultTerminate = (prevCode, currentCode) => prevCode === currentCode;
    const shouldTerminate = terminateCondition || defaultTerminate;

    let prevCode = generator(ast, parserOpts).code;
    let currentAst = ast;

    while (true) {
        for (const plugins of pluginGroups) {
            plugins.forEach((plugin) => {
                if (!plugin.name || !plugin.visitor) {
                    throw new Error(`插件格式错误`);
                }
                Logger.info(`[迭代中] 执行插件：${plugin.name}`);
                currentAst = runPlugin(currentAst, plugin, generatorOpts);
            });

            const codeAfterGroup = generator(currentAst, generatorOpts).code;
            currentAst = parser.parse(codeAfterGroup, parserOpts);
        }

        const currentCode = generator(currentAst, generatorOpts).code;
        if (shouldTerminate(prevCode, currentCode)) {
            Logger.info("迭代优化完成：代码长度稳定");
            break;
        }
        Logger.info(`迭代继续：代码长度从 ${prevCode.length} 变为 ${currentCode.length}`);
        prevCode = currentCode;
    }

    return currentAst;
}

/**
 * 接收代码字符串，返回解混淆后的代码
 */
function transformCodeWithStagedExecution(
    code,
    stages = [],
    parserOpts = {},
    generatorOpts = {},
    logConfig = {}
) {
    const finalParserOpts = {sourceType: "module", plugins: [], ...parserOpts};
    const finalGeneratorOpts = {compact: false, comments: false, jsescOption: {minimal: true}, ...generatorOpts};

    let currentAst = parser.parse(code, finalParserOpts);

    Logger.init(logConfig);
    Logger.info(`=== 开始执行插件 ===`);
    Logger.info(`共配置 ${stages.length} 个执行阶段\n`);

    try {
        stages.forEach((stage, stageIndex) => {
            const {type, plugins = [], terminateCondition} = stage;

            Logger.info(`--- 开始执行阶段 ${stageIndex + 1}（类型：${type}）---`);

            plugins.forEach((plugin) => {
                if (!plugin.name || !plugin.visitor) {
                    throw new Error(`插件格式错误`);
                }
            });

            if (type === 'once') {
                plugins.forEach((plugin, index) => {
                    Logger.info(`[${index + 1}/${plugins.length}] 执行插件：${plugin.name}`);
                    const startTime = Date.now();

                    currentAst = runPlugin(currentAst, plugin, finalGeneratorOpts);

                    Logger.info(`[${plugin.name}] 执行完成，耗时：${Date.now() - startTime}ms`);
                });

                const codeAfterStage = generator(currentAst, finalGeneratorOpts).code;
                currentAst = parser.parse(codeAfterStage, finalParserOpts);
                Logger.info(`--- 阶段 ${stageIndex + 1}（单次）执行完成（已重解析 AST）---\n`);
            } else if (type === 'iterate') {
                const pluginGroups = [[...plugins]];
                currentAst = transformAstWithIteration(
                    currentAst,
                    pluginGroups,
                    finalParserOpts,
                    finalGeneratorOpts,
                    terminateCondition
                );
                Logger.info(`--- 阶段 ${stageIndex + 1}（迭代）执行完成 ---`);
            }
        });
    } finally {
        Logger.restore();
    }

    return generator(currentAst, finalGeneratorOpts).code;
}

/**
 * 文件处理：读入 -> 解混淆 -> 保存
 */
function transformFileWithStagedExecution(filePath, stages, parserOpts, generatorOpts, outputPath, logConfig) {
    if (!fs.existsSync(filePath)) throw new Error(`文件不存在：${filePath}`);

    const inputCode = fs.readFileSync(filePath, 'utf-8');
    const finalCode = transformCodeWithStagedExecution(inputCode, stages, parserOpts, generatorOpts, logConfig);

    const savePath = getSavePath(filePath, outputPath);
    saveFile(savePath, finalCode);

    return finalCode;
}



// -------- split-multi-variable：变量定义逗号赋值改单一赋值 --------
const splitMultiVariableDeclaration = {
    name: 'split-multi-variable',
    visitor: {
        VariableDeclaration(path) {
            const {parentPath, node} = path;
            if (parentPath.isFor()) return;
            const {declarations, kind} = node;
            if (declarations.length <= 1) return;

            const newNodes = declarations.map(varNode =>
                types.variableDeclaration(kind, [varNode])
            );
            path.replaceWithMultiple(newNodes);
        }
    }
};

// -------- standardize-statement-block：单行语句补全中括号 --------
const standardizeStatementBlock = {
    name: 'standardize-statement-block',
    visitor: {
        "ForStatement|WhileStatement|ForInStatement|ForOfStatement|DoWhileStatement"({node}) {
            if (!types.isBlockStatement(node.body)) {
                node.body = types.blockStatement([node.body]);
            }
        },
        IfStatement(path) {
            const consequent = path.get("consequent");
            const alternate = path.get("alternate");

            if (!consequent.isBlockStatement()) {
                consequent.replaceWith(types.blockStatement([consequent.node]));
            }
            if (alternate.node !== null && !alternate.isBlockStatement()) {
                alternate.replaceWith(types.blockStatement([alternate.node]));
            }
        }
    }
};

// -------- unify-member-expression：a.b -> a["b"] --------
const unifyMemberExpression = {
    name: 'unify-member-expression',
    visitor: {
        MemberExpression: {
            exit(path) {
                const {node} = path;
                if (types.isIdentifier(node.property) && node.computed === false) {
                    node.computed = true;
                    node.property = types.stringLiteral(node.property.name);
                }
            }
        }
    }
};

// -------- shift-for-init：提取 for 循环 init 节点到循环外 --------
const shiftForInit = {
    name: 'shift-for-init',
    visitor: {
        ForStatement(path) {
            const {node, scope} = path;
            const {init} = node;

            if (!init) {
                return;
            }

            // 场景1：init 是逗号表达式
            if (types.isSequenceExpression(init)) {
                const {expressions} = init;
                for (const expression of expressions) {
                    path.insertBefore(types.expressionStatement(expression));
                }
            }
            // 场景2：init 是变量声明
            else if (types.isVariableDeclaration(init)) {
                const {declarations, kind} = init;

                // 检测并解决命名冲突：把循环内变量重命名到父作用域唯一名
                for (const decl of declarations) {
                    if (types.isIdentifier(decl.id)) {
                        const name = decl.id.name;
                        const newId = scope.parent.generateUidIdentifier(name);
                        scope.rename(name, newId.name);
                    }
                }

                for (const varNode of declarations) {
                    const newDeclarationNode = types.variableDeclaration(kind, [varNode]);
                    path.insertBefore(newDeclarationNode);
                }
            }
            // 场景3：init 是赋值/逻辑/二进制/调用/三元/更新表达式
            else if (
                types.isAssignmentExpression(init) ||
                types.isLogicalExpression(init) ||
                types.isBinaryExpression(init) ||
                types.isCallExpression(init) ||
                types.isConditionalExpression(init) ||
                types.isUpdateExpression(init)
            ) {
                path.insertBefore(types.expressionStatement(init));
            }
            // 场景4：init 是标识符或字面量（无需处理）
            else if (types.isIdentifier(init) || types.isLiteral(init)) {
                // noop
            }
            // 其他未覆盖场景
            else {
                console.log('init还有其他情况:', path.toString());
                return;
            }

            node.init = null;
        }
    }
};

// -------- resolve-sequence-enhanced：逗号表达式拆分/简化 --------

/** 向上查找分裂上下文 */
function getSplitContext(path) {
    let curr = path;
    let parent = curr.parentPath;

    while (parent) {
        // 黑名单拦截（不安全上下文）
        if (parent.isLogicalExpression() && parent.get('right') === curr) return null;
        if (parent.isConditionalExpression() && (parent.get('consequent') === curr || parent.get('alternate') === curr)) return null;
        if (parent.isArrowFunctionExpression() && parent.get('body') === curr) return null;
        if ((parent.isIfStatement() || parent.isWhileStatement() || parent.isDoWhileStatement()) && parent.get('test') === curr) return null;
        if (parent.isForStatement() && parent.get('update') === curr) return null;

        // 白名单目标
        if (parent.isExpressionStatement()) return {statementPath: parent};

        if (parent.isVariableDeclarator() && parent.get('init') === curr) {
            const varDecl = parent.parentPath;
            if (varDecl.isVariableDeclaration() && (varDecl.parentPath.isBlockStatement() || varDecl.parentPath.isProgram())) {
                return {statementPath: varDecl};
            }
            return null;
        }

        if (parent.isReturnStatement() || parent.isThrowStatement()) return {statementPath: parent};

        if (parent.isStatement()) return null;

        curr = parent;
        parent = curr.parentPath;
    }
    return null;
}

const resolveSequenceExpression = {
    name: 'resolve-sequence-enhanced',
    visitor: {
        SequenceExpression: {
            exit(path) {
                const expressions = path.node.expressions;
                if (expressions.length < 2) return;

                // 策略1：纯净表达式直接简化  x = (1, 2, 3) -> x = 3
                const allPure = expressions.slice(0, -1).every(isPureNode);
                if (allPure) {
                    path.replaceWith(expressions[expressions.length - 1]);
                    return;
                }

                // 策略2：向上查找并拆分
                const context = getSplitContext(path);
                if (!context) return;

                const {statementPath} = context;
                const nodesToInsert = [];
                for (let i = 0; i < expressions.length - 1; i++) {
                    nodesToInsert.push(types.expressionStatement(expressions[i]));
                }
                statementPath.insertBefore(nodesToInsert);
                path.replaceWith(expressions[expressions.length - 1]);
            }
        }
    }
};

// -------- clear-function-flower-instructions：函数花指令还原 --------

function isSimplifiableFunction(path) {
    const {node} = path;

    if (!types.isFunctionDeclaration(node) && !types.isFunctionExpression(node) && !types.isArrowFunctionExpression(node)) {
        return false;
    }

    let statements = [];
    if (types.isBlockStatement(node.body)) {
        statements = node.body.body;
    } else if (types.isExpression(node.body)) {
        statements = [types.returnStatement(node.body)];
    } else {
        return false;
    }

    if (containsScopeSensitiveNodes(node.body)) return false;
    if (statements.length !== 1) return false;
    if (containsFunctionDefinition(node.body)) return false;

    const onlyStatement = statements[0];
    let expr = null;

    if (types.isReturnStatement(onlyStatement)) {
        expr = onlyStatement.argument;
    } else if (types.isExpressionStatement(onlyStatement)) {
        expr = onlyStatement.expression;
        if (types.isAssignmentExpression(expr) || types.isUpdateExpression(expr)) {
            return true;
        }
    } else {
        return false;
    }

    if (expr && isExpressionComplex(expr)) return false;
    return true;
}

function containsFunctionDefinition(node) {
    if (Array.isArray(node)) {
        for (const element of node) {
            if (containsFunctionDefinition(element)) return true;
        }
        return false;
    }
    if (typeof node !== 'object' || node === null) return false;
    if (types.isFunctionDeclaration(node) || types.isFunctionExpression(node) || types.isArrowFunctionExpression(node)) {
        return true;
    }
    for (const key in node) {
        if (node.hasOwnProperty(key)) {
            const child = node[key];
            if (typeof child === 'object' && child !== null && containsFunctionDefinition(child)) {
                return true;
            }
        }
    }
    return false;
}

function isExpressionComplex(expr, depth = 0, maxDepth = 2) {
    if (depth > maxDepth) return true;
    if (types.isConditionalExpression(expr)) {
        if (depth > 1) return true;
        return isExpressionComplex(expr.consequent, depth + 1) || isExpressionComplex(expr.alternate, depth + 1);
    }
    if (types.isObjectExpression(expr) && expr.properties.length > 1) return true;

    const complexTypeChecks = [
        types.isBinaryExpression, types.isUnaryExpression, types.isMemberExpression,
        types.isOptionalMemberExpression, types.isCallExpression, types.isNewExpression,
        types.isArrayExpression, types.isObjectExpression, types.isConditionalExpression,
        types.isSequenceExpression, types.isTemplateLiteral
    ];

    for (const checkType of complexTypeChecks) {
        if (checkType(expr)) {
            for (const key in expr) {
                if (expr.hasOwnProperty(key) && typeof expr[key] === 'object' && expr[key] !== null) {
                    if (isExpressionComplex(expr[key], depth + 1)) return true;
                }
            }
        }
    }
    return false;
}

function containsScopeSensitiveNodes(node) {
    if (Array.isArray(node)) {
        for (const element of node) {
            if (containsScopeSensitiveNodes(element)) return true;
        }
        return false;
    }
    if (typeof node !== 'object' || node === null) return false;
    if (types.isThisExpression(node) || types.isSuper(node) || (types.isIdentifier(node) && node.name === 'arguments')) {
        return true;
    }
    for (const key in node) {
        if (node.hasOwnProperty(key)) {
            const child = node[key];
            if (typeof child === 'object' && child !== null && containsScopeSensitiveNodes(child)) {
                return true;
            }
        }
    }
    return false;
}

function zipNodeArrays(arr1, arr2) {
    const array1 = Array.isArray(arr1) ? arr1 : [];
    const array2 = Array.isArray(arr2) ? arr2 : [];
    const maxLength = Math.max(array1.length, array2.length);
    const result = [];
    for (let i = 0; i < maxLength; i++) {
        const nodeFromArr1 = array1[i] || types.identifier('undefined');
        const nodeFromArr2 = array2[i] || types.identifier('undefined');
        result.push([nodeFromArr1, nodeFromArr2]);
    }
    return result;
}

function safeCopyPath(originalPath) {
    const clonedNode = types.cloneNode(originalPath.node, true);
    const tempAst = parser.parse('');
    const tempParent = types.blockStatement([]);
    tempAst.program.body = [tempParent];

    let clonedPath;
    traverse(tempAst, {
        BlockStatement(path) {
            path.pushContainer('body', clonedNode);
            clonedPath = path.get('body')[0];
            path.stop();
        }
    });
    return clonedPath;
}

function inlineFunction(parentPath, funcPath, referLength) {
    const clonedPath = safeCopyPath(funcPath);
    let argumentList = parentPath.node.arguments;
    let {params} = clonedPath.node;
    let body_0 = clonedPath.get('body.body.0');
    let funcBody;

    if (types.isReturnStatement(body_0)) {
        funcBody = body_0.get('argument');
    } else if (types.isExpressionStatement(body_0) && types.isAssignmentExpression(body_0.get('expression'))) {
        funcBody = body_0;
    } else {
        return referLength;
    }

    let referList = [];
    for (let param of params) {
        let tmp = [];
        let paramBinding = funcBody.scope.getBinding(param.name);
        if (!paramBinding || !paramBinding.constant) {
            return referLength;
        }
        for (let refer of paramBinding.referencePaths) {
            tmp.push(refer);
        }
        referList.push(tmp);
    }
    let zipParams = zipNodeArrays(argumentList, referList);
    for (let map of zipParams) {
        for (let refer of map[1]) {
            refer.replaceWith(map[0]);
        }
    }

    parentPath.replaceWith(funcBody);
    return referLength - 1;
}

function processFunctionPath(funcPath) {
    if (!isSimplifiableFunction(funcPath)) return;

    let {node, parentPath} = funcPath;
    let funcName;
    let binding;

    if (funcPath.isFunctionDeclaration()) {
        funcName = node.id?.name;
        parentPath = funcPath;
    } else if (funcPath.isFunctionExpression()) {
        funcName = parentPath.node.id?.name;
        parentPath = parentPath.parentPath;
    }
    binding = funcPath.scope.parent.getBinding(funcName);
    if (!funcName || !binding || !binding.constant) return;

    const {referencePaths} = binding;
    let referLength = referencePaths.length;
    if (referLength === 0) {
        funcPath.remove();
        return;
    }

    // 倒序处理引用（避免修改 AST 后影响后续路径）
    const startLen = referLength;
    for (const refer of [...referencePaths].reverse()) {
        const callExpr = refer.parentPath;
        if (!callExpr.isCallExpression() || callExpr.get('callee').node.name !== funcName) continue;
        referLength = inlineFunction(callExpr, funcPath, referLength);
    }

    // [优化] 没有任何内联发生时 AST 未变动，scope.crawl() 是纯空操作，直接跳过
    if (referLength === startLen) {
        return;
    }

    // 重构作用域，多往外一层（每内联一个函数都 crawl 是保证正确性的必要操作）
    parentPath.parentPath.scope.crawl();
    if (referLength === 0) {
        parentPath.remove();
    }
}

const clearFlowerInstructions = {
    name: 'clear-function-flower-instructions',
    visitor: {
        FunctionDeclaration(path) {
            processFunctionPath(path);
        },
        FunctionExpression(path) {
            if (!path.parentPath.isVariableDeclarator()) return;
            processFunctionPath(path);
        }
    }
};

// -------- remove-dead-code：移除各种无用代码 --------

// 删除执行后无意义的节点
const removeNonExecutableNodes = {
    name: 'remove-non-executable-nodes',
    visitor: {
        "SequenceExpression"(path) {
            let expressionPaths = path.get('expressions');
            for (let expressPath of expressionPaths.slice(0, -1)) {
                if (expressPath.isIdentifier() || expressPath.isLiteral()) {
                    expressPath.remove();
                }
            }
        },
        "ExpressionStatement"(path) {
            let expressPath = path.get('expression');
            if (expressPath.isIdentifier() || expressPath.isLiteral()) {
                expressPath.remove();
            }
        },
        "EmptyStatement|DebuggerStatement"(path) {
            path.remove();
        },
    }
};

// 删除永不执行的代码（return 等之后的代码）
const removeDeadCodeOfEndNode = {
    name: 'remove-deadCode-of-endNode',
    visitor: {
        "ContinueStatement|BreakStatement|ReturnStatement|ThrowStatement"(path) {
            let AllNextSiblings = path.getAllNextSiblings();
            for (let nextSibling of AllNextSiblings) {
                if (nextSibling.isFunctionDeclaration() || nextSibling.isVariableDeclaration({kind: "var"})) {
                    continue; // 变量提升
                }
                nextSibling.remove();
            }
        },
    }
};

// 围绕逻辑表达式的垃圾代码
const removeDeadCodeOfLogicalExpression = {
    name: 'remove-deadCode-of-logicalExpression',
    visitor: {
        "LogicalExpression"(path) {
            let {parentPath, node} = path;
            let {left, operator, right} = node;

            // 1. 处理左侧
            let leftPath = path.get('left');
            const evaluateLeft = leftPath.evaluateTruthy();
            if ((operator === "||" && evaluateLeft === true) ||
                (operator === "&&" && evaluateLeft === false)) {
                path.replaceWith(left);
                return;
            }
            if (types.isLiteral(left)) {
                if (operator === "||" && !left.value) {
                    path.replaceWith(right);
                    return;
                }
                if (operator === "&&" && !left.value) {
                    path.replaceWith(left);
                    return;
                }
            }

            // 2. ExpressionStatement 特殊优化（语句级，不关心返回值）
            if (parentPath.isExpressionStatement({"expression": node})) {
                if (types.isLiteral(right) || types.isIdentifier(right)) {
                    path.replaceWith(left);
                    return;
                }
            }

            // 3. 处理右侧（危险区）
            if (types.isLiteral(right)) {
                if (types.isNullLiteral(right)) {
                    return; // x || null / x && null 保留原样
                }
                if (types.isBooleanLiteral(right)) {
                    if ((operator === "||" && !right.value) ||
                        (operator === "&&" && right.value)) {
                        path.replaceWith(left);
                    }
                }
            }
        },
    },
};

// 变量定义与赋值语句无引用时删除（涉及 scope，需重新解析）
const removeDeadCodeOfIdentifier = {
    name: 'remove-deadCode-of-Identifier',
    visitor: {
        "VariableDeclarator"(path) {
            let {node, scope, parentPath, parent} = path;
            let ancestryPath = parentPath.parentPath;

            if (ancestryPath.isForOfStatement({left: parent}) ||
                ancestryPath.isForInStatement({left: parent})) {
                return;
            }

            let {id, init} = node;
            if (!types.isIdentifier(id) || types.isCallExpression(init) ||
                types.isAssignmentExpression(init)) {
                return;
            }

            let binding = scope.getBinding(id.name);
            if (!binding) return;

            let {referenced, constant, constantViolations} = binding;
            if (referenced || constantViolations.length > 1) {
                return;
            }
            if (constant || constantViolations[0] === path) {
                path.remove();
            }
        },
        AssignmentExpression(path) {
            let {scope, node, parentPath} = path;
            let {left, operator, right} = node;

            if (!types.isIdentifier(left) || operator !== "=") {
                return;
            }
            if (types.isAssignmentExpression(right) || types.isCallExpression(right)) {
                return;
            }

            let binding = scope.getBinding(left.name);
            if (!binding || binding.referenced) {
                return;
            }

            let {constantViolations} = binding;
            if (constantViolations.length === 1 && constantViolations[0] === path) {
                if (parentPath.isExpressionStatement() || parentPath.isSequenceExpression()) {
                    path.remove();
                }
            }
        }
    },
    needReparse: true
};

// 简化 IfStatement 和 ConditionalExpression，消除死代码
const removeDeadCodeOfConditional = {
    name: 'remove-deadCode-of-Conditional',
    visitor: {
        IfStatement(path) {
            const consequent = path.get("consequent");
            const alternate = path.get("alternate");
            const test = path.get("test");
            const evaluateTest = test.evaluateTruthy();

            // 标准化块语句
            if (!consequent.isBlockStatement()) {
                consequent.replaceWith(types.blockStatement([consequent.node]));
            }
            if (alternate.node !== null && !alternate.isBlockStatement()) {
                alternate.replaceWith(types.blockStatement([alternate.node]));
            }

            // 真值分支为空
            if (consequent.node.body.length === 0) {
                if (alternate.node === null) {
                    path.replaceWith(test.node);
                } else {
                    consequent.replaceWith(alternate.node);
                    alternate.remove();
                    path.node.alternate = null;
                    test.replaceWith(types.unaryExpression("!", test.node, true));
                }
                return;
            }

            // 假值分支为空
            if (alternate.isBlockStatement() && alternate.node.body.length === 0) {
                alternate.remove();
                path.node.alternate = null;
            }

            // 布尔条件优化
            if (evaluateTest === true) {
                path.replaceWithMultiple(consequent.node.body);
            } else if (evaluateTest === false) {
                alternate.node === null ? path.remove() : path.replaceWithMultiple(alternate.node.body);
            }
        },
        ConditionalExpression(path) {
            let {test, consequent, alternate} = path.node;
            let testPath = path.get('test');
            let evaluateTest = testPath.evaluateTruthy();

            if (testPath.isAssignmentExpression()) {
                evaluateTest = testPath.get('right').evaluateTruthy();
            }
            if (evaluateTest === undefined) {
                return;
            }
            if (testPath.isIdentifier() || testPath.isLiteral()) {
                if (evaluateTest === true) {
                    path.replaceWith(consequent);
                } else {
                    path.replaceWith(alternate);
                }
                return;
            }

            let SequenceNode = null;
            if (evaluateTest === true) {
                SequenceNode = types.sequenceExpression([test, consequent]);
            } else {
                SequenceNode = types.sequenceExpression([test, alternate]);
            }
            path.replaceWith(SequenceNode);
        }
    },
    needReparse: true
};

// 删除没有被调用的函数定义
const removeDeadFunctionDeclaration = {
    name: 'remove-dead-function-declaration',
    visitor: {
        FunctionDeclaration(path) {
            let {parentPath, node} = path;
            if (parentPath.isProgram()) {
                return; // 全局函数不处理
            }

            let binding = parentPath.scope.getBinding(node.id.name);
            if (!binding) return;

            let isReferenced = false;
            for (let referPath of binding.referencePaths) {
                if (!path.isAncestor(referPath)) {
                    isReferenced = true;
                    break;
                }
            }
            if (!isReferenced) {
                console.log(path.toString());
                path.remove();
            }
        }
    },
    needReparse: true
};

// 死代码移除预设集合
const removeAllDeadCode = {
    name: 'remove-all-dead-code',
    visitor: [
        removeNonExecutableNodes,
        removeDeadCodeOfEndNode,
        removeDeadCodeOfLogicalExpression,
        removeDeadCodeOfIdentifier,
        removeDeadCodeOfConditional,
        removeDeadFunctionDeclaration
    ]
};


// -------- bypass-format-check：格式化检测绕过 --------
const bypassFormatCheck = {
    name: "bypass-format-check",
    visitor: {
        FunctionExpression(path) {
            let {node, scope} = path;
            let {id} = node;
            if (!id || id.name.length !== 10) return;
            // BMS 外层 IIFE 也是 10 字符名（XDwZvsbSdw），不能当成格式检测桩
            let calleePath = path.parentPath.isParenthesizedExpression() ? path.parentPath : path;
            if (calleePath.parentPath.isCallExpression() && calleePath.parentPath.node.callee === calleePath.node) {
                const fileCode = path.hub && path.hub.file && path.hub.file.code;
                if (fileCode && node.start != null && node.end != null) {
                    bmsOriginalIifeSource = fileCode.slice(node.start, node.end);
                }
                return;
            }
            let binding = scope.getBinding(id.name);
            let {constant, referencePaths} = binding;
            if (!constant || referencePaths.length !== 1) {
                throw new Error("函数(id.name.length === 10)引用只能为1!");
            }
            let expressPath = referencePaths[0].getStatementParent();
            // 在引用前插入该函数的 toString 方法
            expressPath.insertBefore(types.expressionStatement(types.assignmentExpression(
                "=",
                types.memberExpression(id, types.identifier("toString"), false),
                types.functionExpression(
                    types.identifier("toString"),
                    [],
                    types.blockStatement([
                        types.returnStatement(
                            types.stringLiteral(generator(node, {compact: true}).code),
                        ),
                    ]),
                ),
            )));
            path.stop();
        }
    }
};

// -------- clear-jsfuck：JSFuck 清理（常量折叠） --------
const clearJsFuck = {
    name: "clear-jsfuck",
    visitor: {
        "BinaryExpression|UnaryExpression|MemberExpression"(path) {
            const {node} = path;

            // 策略1：Babel 自带静态求值
            const {confident, value} = path.evaluate();
            if (confident) {
                if (["number", "string", "boolean"].includes(typeof value) || value === null) {
                    const newNode = types.valueToNode(value);
                    if (newNode) {
                        console.log(`[Clear-JSFuck] Evaluated: ${path.toString()}  ===>  ${value}`);
                        path.replaceWith(newNode);
                        path.skip();
                        return;
                    }
                }
                if (value === undefined) {
                    path.replaceWith(types.identifier("undefined"));
                    path.skip();
                    return;
                }
            }

            // 策略2：手动处理 [][[]] -> undefined
            if (types.isMemberExpression(node)) {
                const {object, property, computed} = node;
                if (
                    computed &&
                    types.isArrayExpression(object) && object.elements.length === 0 &&
                    types.isArrayExpression(property) && property.elements.length === 0
                ) {
                    console.log(`[Clear-JSFuck] Manual replace: [][[]] ===> undefined`);
                    path.replaceWith(types.identifier("undefined"));
                    path.skip();
                }
            }
        }
    }
};

// -------- replace-number-loop：常量计算与传播（循环至稳定） --------
const replaceNumberLoop = {
    name: "replace-number-loop",
    visitor: {
        Program(path) {
            let changed = true;
            let loopCount = 0;
            const MAX_LOOPS = 100;

            while (changed && loopCount < MAX_LOOPS) {
                changed = false;
                loopCount++;

                path.traverse({
                    // 1. 常量计算
                    "BinaryExpression|UnaryExpression|MemberExpression|CallExpression"(subPath) {
                        const {confident, value} = subPath.evaluate();
                        if (confident && typeof value === 'number' && Number.isFinite(value)) {
                            subPath.replaceWith(types.numericLiteral(value));
                            subPath.skip();
                            changed = true;
                        }
                    },
                    // 2. 常量传播（a = 1）
                    AssignmentExpression(subPath) {
                        const {node, scope} = subPath;
                        const {left, right, operator} = node;

                        if (operator !== "=" || !types.isIdentifier(left) || !types.isNumericLiteral(right)) {
                            return;
                        }

                        const name = left.name;
                        const binding = scope.getBinding(name);
                        if (!binding) return;

                        const targetValue = right.value;
                        let isSafeToReplace = true;

                        if (binding.path.isVariableDeclarator()) {
                            const init = binding.path.node.init;
                            if (init && (!types.isNumericLiteral(init) || init.value !== targetValue)) {
                                isSafeToReplace = false;
                            }
                        }

                        if (isSafeToReplace && !binding.constant) {
                            for (const violation of binding.constantViolations) {
                                if (!violation.isAssignmentExpression() ||
                                    violation.node.operator !== '=' ||
                                    !types.isNumericLiteral(violation.node.right) ||
                                    violation.node.right.value !== targetValue) {
                                    isSafeToReplace = false;
                                    break;
                                }
                            }
                        }

                        if (isSafeToReplace) {
                            binding.referencePaths.forEach(refPath => {
                                if (!refPath.isNumericLiteral()) {
                                    refPath.replaceWith(types.numericLiteral(targetValue));
                                    changed = true;
                                }
                            });

                            if (subPath.parentPath.isExpressionStatement()) {
                                subPath.remove();
                                changed = true;
                            } else {
                                subPath.replaceWith(types.numericLiteral(targetValue));
                                changed = true;
                            }
                        }
                    }
                });
            }

            if (loopCount > 1) {
                console.log(`[replace-number] Finished in ${loopCount} loops.`);
            }
        }
    }
};

// -------- remove-brace-in-case：去掉 switch case 中的大括号 --------
const removeBraceInCase = {
    name: "remove-brace-in-case",
    visitor: {
        SwitchCase(path) {
            let {node} = path;
            if (node.consequent.length > 0 && types.isBlockStatement(node.consequent[0])) {
                const blockBody = node.consequent[0].body;
                node.consequent.splice(0, 1, ...blockBody);
            }
        }
    }
};

// -------- flatten-control-flow / handle-special-control-flows：控制流平坦化还原 --------

const flattenControlFlowVisitor = {
    SwitchStatement(path) {
        let {node} = path;
        let {discriminant, cases} = node;
        if (!types.isIdentifier(discriminant)) {
            return;
        }
        let discriminantName = discriminant.name;
        let functionPath = path.getFunctionParent();
        let {id, params} = functionPath.node;
        if (params[0].name !== discriminantName) {
            return;
        }
        let functionName = id.name;
        let varName;
        if (functionPath.parentPath.isVariableDeclarator()) {
            varName = functionPath.parentPath.node.id.name;
        }
        let switchIndexArray = [];
        let caseObj = {};

        for (let curCase of cases) {
            let {test, consequent} = curCase;
            if (!types.isNumericLiteral(test)) {
                return;
            }
            let curValue = test.value;
            let dumpValue = null;
            for (let index in consequent) {
                let _consequent = consequent[index];
                if (!types.isExpressionStatement(_consequent) || !types.isAssignmentExpression(_consequent.expression)) {
                    continue;
                }
                let {left, operator, right} = _consequent.expression;
                if (!types.isIdentifier(left, {name: discriminantName})) {
                    continue;
                }
                if (!types.isNumericLiteral(right)) {
                    console.log('右边不是数字!', generator(_consequent).code);
                    return;
                }
                if (operator === '=') {
                    dumpValue = right.value;
                    consequent.splice(index, 1);
                    break;
                } else if (operator === '+=' || operator === '-=') {
                    dumpValue = eval(`${curValue}
                    ${operator.slice(0, 1)}
                    ${right.value}`);
                    consequent.splice(index, 1);
                    break;
                } else {
                    console.log('还有其他运算符!', generator(_consequent).code);
                    return;
                }
            }
            if (types.isBreakStatement(consequent[consequent.length - 1])) {
                consequent = consequent.slice(0, consequent.length - 1);
            }
            caseObj[curValue] = [consequent, dumpValue];
        }

        function makeNewFunction(referencePath, index, newFunctionName) {
            referencePath.replaceWith(types.identifier(newFunctionName));
            if (switchIndexArray.includes(index)) {
                return;
            }
            switchIndexArray.push(index);
            let newStatements = caseObj[index][0];
            let nextIndex = caseObj[index][1];
            while (nextIndex !== null) {
                if (!caseObj[nextIndex]) {
                    break;
                }
                newStatements.push(...caseObj[nextIndex][0]);
                nextIndex = caseObj[nextIndex][1];
            }
            let functionDeclaration = types.functionDeclaration(types.identifier(newFunctionName), params, types.blockStatement(newStatements));
            if (functionPath.parentPath.isVariableDeclarator()) {
                functionPath.parentPath.parentPath.insertBefore(functionDeclaration);
            } else {
                functionPath.insertBefore(functionDeclaration);
            }
        }

        function getIndex(callName) {
            let binding = functionPath.scope.getBinding(callName);
            if (!binding) {
                return;
            }
            let {referencePaths} = binding;
            for (let referencePath of referencePaths) {
                let parentPath = referencePath.parentPath;
                if (parentPath.type === 'CallExpression') {
                    let {arguments: args} = parentPath.node;
                    if (args.length !== 2 || !types.isNumericLiteral(args[0])) {
                        console.log('调用结构异常!', parentPath.toString());
                        return;
                    }
                    makeNewFunction(referencePath, args[0].value, `${functionName}_${args[0].value}`);
                } else if (parentPath.type === 'MemberExpression') {
                    let propertyName = parentPath.node.property.value;
                    parentPath = parentPath.parentPath;
                    let {arguments: args} = parentPath.node;
                    if (propertyName === 'apply') {
                        if (args.length !== 2 || !types.isArrayExpression(args[1])) {
                            console.log('调用结构异常!', parentPath.toString());
                            return;
                        }
                        let element0 = args[1].elements[0];
                        if (!types.isNumericLiteral(element0)) {
                            console.log('调用结构异常!', parentPath.toString());
                            return;
                        }
                        makeNewFunction(referencePath, element0.value, `${functionName}_${element0.value}`);
                    } else if (propertyName === 'call') {
                        if (args.length < 2 || !types.isNumericLiteral(args[1])) {
                            console.log('调用结构异常!', parentPath.toString());
                            return;
                        }
                        makeNewFunction(referencePath, args[1].value, `${functionName}_${args[1].value}`);
                    } else {
                        console.log('成员表达式还有其他类型!', parentPath.toString());
                        return;
                    }
                }
            }
        }

        getIndex(functionName);
        varName ? getIndex(varName) : 0;
        varName ? functionPath.parentPath.remove() : functionPath.remove();
    }
};

const handleSpecialControlFlowsVisitor = {
    SwitchStatement(path, state) {
        const ast = state.rootAst;
        let {node} = path;
        let {discriminant, cases} = node;
        if (!types.isBinaryExpression(discriminant)) {
            return;
        }
        let {left, operator, right} = discriminant;
        if (operator !== '+') {
            return;
        }
        let leftName = left.name;
        let rightName = right.name;
        let functionPath = path.getFunctionParent();
        let {id, params} = functionPath.node;
        if (params[0].name !== rightName) {
            console.log('rightName不匹配!');
            return;
        }
        let functionName = id.name;
        let varName;
        if (types.isVariableDeclarator(functionPath.parentPath)) {
            varName = functionPath.parentPath.node.id.name;
        }
        let statement = path.parentPath.parentPath;
        if (!types.isForStatement(statement) && !types.isWhileStatement(statement) && !types.isDoWhileStatement(statement)) {
            return;
        }
        let allPrevSiblings = statement.getAllPrevSiblings();
        let old_args = allPrevSiblings[0].node.expression.arguments;
        allPrevSiblings[0].node.expression.arguments = [types.numericLiteral(1)];
        if (allPrevSiblings[1].node.declarations[0].id.name !== leftName) {
            console.log('leftName不匹配!');
        }
        let switch_code = `${allPrevSiblings[2].toString()}\n${allPrevSiblings[1].toString()}`;

        // 主动报错以寻找依赖函数
        while (1) {
            try {
                new Function(switch_code + `  ${allPrevSiblings[0].toString()}`)();
                break;
            } catch (e) {
                const regex = /ReferenceError: ([$_a-zA-Z0-9]+) is not defined/;
                const match = regex.exec(e.stack);
                if (match && match[1]) {
                    const func_name = match[1];
                    traverse(ast, {
                        FunctionDeclaration(_path) {
                            if (_path.node.id.name === func_name) {
                                _path.traverse({
                                    CallExpression(__path) {
                                        if (__path.toString().includes('push') || __path.toString().includes('pop')) {
                                            __path.remove();
                                        }
                                    }
                                });
                                switch_code = `${_path.toString()}\n` + switch_code;
                            }
                        }
                    });
                }
            }
        }
        allPrevSiblings[0].node.expression.arguments = old_args;
        let stopNumber = statement.node.test.right.value;
        let switchIndexArray = [];
        let caseObj = {};

        for (let curCase of cases) {
            let {test, consequent} = curCase;
            if (!types.isNumericLiteral(test)) {
                return;
            }
            let curValue = test.value;
            let dumpValue = null;
            for (let index in consequent) {
                let _consequent = consequent[index];
                if (!types.isExpressionStatement(_consequent) || !types.isAssignmentExpression(_consequent.expression)) {
                    continue;
                }
                let {left, operator, right} = _consequent.expression;
                if (!types.isIdentifier(left, {name: rightName})) {
                    continue;
                }
                if (!types.isNumericLiteral(right)) {
                    console.log('右边不是数字!', generator(_consequent).code);
                    return;
                }
                if (operator === '=') {
                    dumpValue = right.value;
                    consequent.splice(index, 1);
                    break;
                } else if (operator === '+=' || operator === '-=') {
                    dumpValue = `${operator.slice(0, 1)}${right.value}`;
                    consequent.splice(index, 1);
                    break;
                } else {
                    console.log('还有其他运算符!', generator(_consequent).code);
                    return;
                }
            }
            if (types.isBreakStatement(consequent[consequent.length - 1])) {
                consequent = consequent.slice(0, consequent.length - 1);
            }
            caseObj[curValue] = [consequent, dumpValue];
        }

        function makeNewFunction(referencePath, index, newFunctionName) {
            referencePath.replaceWith(types.identifier(newFunctionName));
            if (switchIndexArray.includes(index)) {
                return;
            }
            switchIndexArray.push(index);

            let _arguments = allPrevSiblings[0].node.expression.arguments;
            if (_arguments.length !== 1) {
                参数异常;
            }
            if (types.isIdentifier(_arguments[0])) {
                allPrevSiblings[0].node.expression.arguments = [types.numericLiteral(index)];
            } else if (types.isBinaryExpression(_arguments[0])) {
                if (!types.isNumericLiteral(_arguments[0].right)) {
                    BinaryExpression结构异常;
                }
                _arguments[0].left = types.numericLiteral(index);
                allPrevSiblings[0].node.expression.arguments = _arguments;
            }
            eval(switch_code + `  ${allPrevSiblings[0].toString()}`);
            allPrevSiblings[0].node.expression.arguments = _arguments;
            let new_index = index;
            let newStatements;
            let isDoWhileFirst = false;
            while (true) {
                if (types.isDoWhileStatement(statement) && !isDoWhileFirst) {
                    isDoWhileFirst = true;
                } else {
                    let first_cal_result = eval(`${leftName} + ${new_index}`);
                    if (first_cal_result === stopNumber) {
                        break;
                    }
                }
                let second_cal_result = eval(`${leftName} + ${new_index}`);
                if (!caseObj[second_cal_result]) {
                    break;
                }
                newStatements ? newStatements.push(...caseObj[second_cal_result][0]) : newStatements = caseObj[second_cal_result][0];
                let nextCalIndex = caseObj[second_cal_result][1];
                if (nextCalIndex === null) {
                    break;
                }
                new_index = eval(`${new_index}
                ${nextCalIndex}`);
            }
            let functionDeclaration = types.functionDeclaration(types.identifier(newFunctionName), params, types.blockStatement(newStatements));
            if (types.isVariableDeclarator(functionPath.parentPath)) {
                functionPath.parentPath.parentPath.insertBefore(functionDeclaration);
            } else {
                functionPath.insertBefore(functionDeclaration);
            }
        }

        function getIndex(callName) {
            let binding = functionPath.scope.getBinding(callName);
            if (!binding) {
                return;
            }
            for (let referencePath of binding.referencePaths) {
                let parentPath = referencePath.parentPath;
                if (parentPath.type === 'CallExpression') {
                    let {arguments: args} = parentPath.node;
                    if (args.length !== 2 || !types.isNumericLiteral(args[0])) {
                        console.log('调用结构异常!', parentPath.toString());
                        return;
                    }
                    makeNewFunction(referencePath, args[0].value, `${functionName}_${args[0].value}`);
                } else if (parentPath.type === 'MemberExpression') {
                    let propertyName = parentPath.node.property.value;
                    parentPath = parentPath.parentPath;
                    let {arguments: args} = parentPath.node;
                    if (propertyName === 'apply') {
                        if (args.length !== 2 || !types.isArrayExpression(args[1])) {
                            console.log('调用结构异常!', parentPath.toString());
                            return;
                        }
                        let element0 = args[1].elements[0];
                        if (!types.isNumericLiteral(element0)) {
                            console.log('调用结构异常!', parentPath.toString());
                            return;
                        }
                        makeNewFunction(referencePath, element0.value, `${functionName}_${element0.value}`);
                    } else if (propertyName === 'call') {
                        if (args.length < 2 || !types.isNumericLiteral(args[1])) {
                            console.log('调用结构异常!', parentPath.toString());
                            return;
                        }
                        makeNewFunction(referencePath, args[1].value, `${functionName}_${args[1].value}`);
                    } else {
                        console.log('成员表达式还有其他类型!', parentPath.toString());
                        return;
                    }
                }
            }
        }

        getIndex(functionName);
        varName ? getIndex(varName) : 0;
        varName ? functionPath.parentPath.remove() : functionPath.remove();
    }
};

const flattenControlFlow = {
    name: "flatten-control-flow",
    visitor: flattenControlFlowVisitor,
    needReparse: true
};

const handleSpecialControlFlows = {
    name: "handle-special-control-flows",
    visitor: handleSpecialControlFlowsVisitor,
    needReparse: true
};

// -------- restore-string：字符串解密还原 --------
const restoreString = {
    name: "restore-string",
    visitor: {
        Program(path) {
            const ast = path.node;
            globalThis.window = globalThis;
            let newlyAddedList = [];

            function findLen10(nextSibling, find_10) {
                nextSibling.traverse({
                    FunctionExpression(_path) {
                        let {node} = _path;
                        let {id} = node;
                        if (id?.name.length === 10) {
                            console.log('找到函数名长度为10的函数 ===> ', id.name);
                            find_10 = true;
                            _path.stop();
                        }
                    }
                });
                return find_10;
            }

            let sjs_se_global_subkey_name;
            let find_10 = false;
            let sjsPath;
            const find_sjs_se_global_subkey = {
                AssignmentExpression(path) {
                    if (!path.toString().includes('sjs_se_global_subkey') || path.toString().includes('toString')) {
                        return;
                    }
                    sjs_se_global_subkey_name = path.node.left.name;
                    console.log('获取sjs_se_global_subkey ===> ', sjs_se_global_subkey_name);

                    sjsPath = path.find(_path => types.isExpressionStatement(_path));
                    let allNextSiblings = sjsPath.getAllNextSiblings();

                    for (let nextSibling of allNextSiblings) {
                        find_10 = findLen10(nextSibling, find_10);
                        if (find_10) {
                            nextSibling.insertAfter(types.returnStatement());
                            newlyAddedList.push(nextSibling.getNextSibling());
                            let runFunc = types.expressionStatement(types.assignmentExpression("=", types.memberExpression(types.identifier("global"), types.identifier("runFunc"), false), types.functionExpression(null, [
                                types.identifier("code"),
                                types.identifier("num"),
                            ], types.blockStatement([
                                types.expressionStatement(
                                    types.assignmentExpression(
                                        "=",
                                        types.identifier(sjs_se_global_subkey_name),
                                        types.arrayExpression([
                                            types.identifier("num"),
                                        ])
                                    )
                                ),
                                types.returnStatement(
                                    types.callExpression(
                                        types.identifier("eval"),
                                        [
                                            types.identifier("code"),
                                        ],
                                    ),
                                ),
                            ]),),));
                            nextSibling.insertAfter(runFunc);
                            newlyAddedList.push(nextSibling.getNextSibling());
                            break;
                        }
                    }
                    if (!find_10) {
                        console.log('未找到函数名长度为10的函数!');
                    }
                    path.stop();
                }
            };

            const findNumberList = {
                "AssignmentExpression": {
                    enter(path) {
                        let {node, parentPath} = path;
                        let {left, right} = node;
                        if (
                            !types.isIdentifier(left)
                            || !types.isCallExpression(right)
                            || right.arguments.length !== 2
                            || !types.isNumericLiteral(right.arguments[0])
                            || !types.isArrayExpression(right.arguments[1])
                            || !types.isArrayExpression(right.arguments[1].elements[0])
                        ) {
                            return;
                        }
                        let nitian = types.expressionStatement(types.assignmentExpression('=', types.memberExpression(types.identifier('global'), types.identifier('nitian' + left.name)), types.identifier(left.name)));
                        parentPath.insertAfter(nitian);
                        newlyAddedList.push(parentPath.getNextSibling());
                    }
                }
            };

            const restoreNumberList = {
                "AssignmentExpression": {
                    enter(path) {
                        let {node, parentPath} = path;
                        let {left, right} = node;
                        if (
                            !types.isIdentifier(left)
                            || !types.isCallExpression(right)
                            || right.arguments.length !== 2
                            || !types.isNumericLiteral(right.arguments[0])
                            || !types.isArrayExpression(right.arguments[1])
                            || !types.isArrayExpression(right.arguments[1].elements[0])
                        ) {
                            return;
                        }
                        let binding = parentPath.scope.getBinding(left.name);
                        if (!binding || binding.constantViolations.length !== 1) {
                            console.log('数字数组的constantViolations不为1!');
                            return;
                        }
                        for (let refer of binding.referencePaths) {
                            let referParent = refer.parentPath;
                            let result = eval("global.nitian" + referParent.toString());
                            console.log(referParent.toString(), ' ===> ', result);
                            referParent.replaceWith(types.valueToNode(result));
                        }
                    }
                }
            };

            function collectDecodeFunc(ast) {
                const decodeFuncList = [];
                traverse(ast, {
                    FunctionDeclaration(path) {
                        let {node, scope} = path;
                        let {id, params, body} = node;
                        let funcName = id.name;
                        body = body.body;
                        if (params.length !== 0 || !types.isVariableDeclaration(body[0]) ||
                            !types.isExpressionStatement(body[1]) || !types.isReturnStatement(body[2])) {
                            return;
                        }
                        if (body[0].declarations[0].id?.name !== body[2].argument?.name) {
                            return;
                        }
                        let declaration = body[0].declarations[0];
                        // 数组则将调用位置还原 dM(1) ==> 'Yb'
                        if (types.isArrayExpression(declaration.init) && declaration.init.elements.length !== 0) {
                            let declaration = body[0].declarations[0];
                            if (!types.isArrayExpression(declaration.init) || declaration.init.elements.length === 0) {
                                return;
                            }
                            let binding = scope.getBinding(funcName);
                            if (binding.constantViolations.length !== 1) {
                                console.log('数组还原存在异常!');
                                return;
                            }
                            let strArray = declaration.init.elements;
                            for (let referencePath of binding.referencePaths) {
                                let referPParent = referencePath.parentPath.parentPath;
                                if (referPParent.type !== 'MemberExpression') {
                                    continue;
                                }
                                let result = strArray[referPParent.node.property.value];
                                referPParent.replaceWith(result);
                            }
                            return;
                        }

                        decodeFuncList.push(funcName);
                        let decodeFunc = types.expressionStatement(types.assignmentExpression("=", types.memberExpression(types.identifier("global"), id, false,), declaration.id,));
                        let bod0yPath = path.get('body.body')[0];
                        bod0yPath.insertAfter(decodeFunc);
                        newlyAddedList.push(bod0yPath.getNextSibling());
                    }
                });
                return decodeFuncList;
            }

            let specialName;
            const handleSpecial = {
                FunctionDeclaration(path) {
                    let {node, scope} = path;
                    let {id, params, body} = node;
                    body = body.body;
                    if (params.length !== 0 || !path.toString().includes('typeof window')) {
                        return;
                    }
                    // ABCK: 两行函数；BMS rC() 更长，只做 window 别名替换
                    if (body.length === 2 && body[0] && body[0].expression && body[0].expression.left) {
                        let objName = body[0].expression.left;
                        specialName = objName.name;
                        let decodeObj = types.expressionStatement(types.assignmentExpression("=", types.memberExpression(types.identifier("global"), objName, false,), objName));
                        let bod0yPath = path.get('body.body')[0];
                        bod0yPath.insertAfter(decodeObj);
                        newlyAddedList.push(bod0yPath.getNextSibling());
                    }

                    path.traverse({
                        AssignmentExpression(_path) {
                            let {left, right} = _path.node;
                            if (right?.name !== 'window') {
                                return;
                            }
                            let windowName = left.name;
                            let binding = scope.getBinding(windowName);
                            if (!binding) return;
                            for (let refer of binding.referencePaths) {
                                if (!types.isMemberExpression(refer.parentPath)) {
                                    continue;
                                }
                                if (refer.parentPath.node.property.value === 'window') {
                                    refer.parentPath.replaceWith(types.identifier('window'));
                                } else {
                                    refer.replaceWith(types.identifier('window'));
                                }
                            }
                            path.stop();
                        }
                    });
                }
            };

            const restoreSpecial = {
                CallExpression(path) {
                    let {node} = path;
                    let {callee} = node;
                    if (!types.isMemberExpression(callee)) {
                        return;
                    }
                    let {object, property} = callee;
                    if (!types.isIdentifier(object, {name: specialName}) || !types.isStringLiteral(property)) {
                        return;
                    }
                    let result = eval(path.toString());
                    console.log(path.toString(), ' ===> ', result);
                    path.replaceWith(types.valueToNode(result));
                }
            };

            let directFuncNames = [];
            let needNumberFuncNames = [];

            function haveDecodeFunc(node) {
                if (types.isConditionalExpression(node)) {
                    return containsDecodeFunc(node.consequent) || containsDecodeFunc(node.alternate);
                }
            }

            function containsDecodeFunc(node) {
                if (!node) return false;
                if (types.isIdentifier(node)) {
                    return decodeFuncNames.includes(node.name);
                }
                if (types.isCallExpression(node)) {
                    return containsDecodeFunc(node.callee);
                }
                if (types.isMemberExpression(node)) {
                    return containsDecodeFunc(node.object);
                }
                return false;
            }

            const diffDecodeFuncName = {
                AssignmentExpression: function (path) {
                    let {node} = path;
                    let {left, operator, right} = node;
                    if (operator !== "=") return;
                    if (!types.isMemberExpression(left) || !types.isCallExpression(left.object)) return;
                    if (!types.isConditionalExpression(right) && !types.isCallExpression(right)) return;
                    if (!containsDecodeFunc(left)) return;
                    if (types.isConditionalExpression(right)) {
                        needNumberFuncNames.push(left.object.callee.name);
                    }
                    if (types.isCallExpression(right)) {
                        directFuncNames.push(left.object.callee.name);
                    }
                }
            };

            const simplifyTypeof = {
                ConditionalExpression: {
                    exit: function (path) {
                        let {node} = path;
                        if (!haveDecodeFunc(node)) return;
                        try {
                            if (global.runFunc(generator(node.test, {compact: false}).code)) {
                                path.replaceWith(node.consequent);
                            } else {
                                path.replaceWith(node.alternate);
                            }
                        } catch (e) {
                        }
                    }
                },
            };

            const restoreInternal = {
                CallExpression: {
                    exit: function (path) {
                        let {node} = path;
                        let {callee} = node;
                        if (!types.isMemberExpression(callee)) return;
                        let {object, property} = callee;
                        if (types.isCallExpression(object) && types.isStringLiteral(property)) {
                            if (!containsDecodeFunc(object)) {
                                return;
                            }
                            let defuncMapName = object.callee.name;
                            if (!directFuncNames.includes(defuncMapName)) return;
                            let result = global.runFunc(path.toString().replaceAll(`${defuncMapName}()`, `global.${defuncMapName}`));
                            console.log(path.toString(), ' ===> ', result);
                            path.replaceWith(types.stringLiteral(result));
                        } else if (types.isMemberExpression(object) && types.isStringLiteral(property) && types.isCallExpression(object.object)) {
                            if (!containsDecodeFunc(object)) return;
                            if (!["call", "apply"].includes(property.value)) debugger;
                            let defuncMapName = object.object.callee.name;
                            if (!directFuncNames.includes(defuncMapName)) return;
                            let result = global.runFunc(path.toString().replaceAll(`${defuncMapName}()`, `global.${defuncMapName}`));
                            console.log(path.toString(), ' ===> ', result);
                            path.replaceWith(types.stringLiteral(result));
                        }
                    }
                }
            };

            const restoreExternal = {
                "BlockStatement|SwitchCase": {
                    exit: function (path) {
                        // [优化] eval(astCode) 已移至遍历前只执行一次（见主流程），
                        // 此处不再对每个 block/case 重复 eval 整段程序。
                        let {node} = path;
                        let body = path.type === 'BlockStatement' ? node.body : node.consequent;
                        let num;

                        body.map(statement => {
                            if (types.isCallExpression(statement.expression)) {
                                let {callee, arguments: args} = statement.expression;
                                if (!types.isMemberExpression(callee) || !types.isIdentifier(callee.object, {name: sjs_se_global_subkey_name}) || !types.isStringLiteral(callee.property, {value: "push"}) || args.length !== 1 || !types.isNumericLiteral(args[0])) {
                                    return;
                                }
                                if (!num) {
                                    num = args[0].value;
                                } else {
                                    throw "no one";
                                }
                            }
                        });

                        if (num === undefined) return;
                        path.traverse({
                            CallExpression: {
                                exit: function (path) {
                                    let {node} = path;
                                    let {callee} = node;
                                    if (!types.isMemberExpression(callee)) return;
                                    let {object, property} = callee;
                                    if (types.isCallExpression(object) && types.isStringLiteral(property)) {
                                        if (!containsDecodeFunc(object)) return;
                                        let defuncMapName = object.callee.name;
                                        if (!needNumberFuncNames.includes(defuncMapName)) return;
                                        let result = global.runFunc(path.toString().replaceAll(`${defuncMapName}()`, `global.${defuncMapName}`), num);
                                        console.log(path.toString(), ' ===> ', result);
                                        path.replaceWith(types.stringLiteral(result));
                                    } else if (types.isMemberExpression(object) && types.isStringLiteral(property) && types.isCallExpression(object.object)) {
                                        if (!containsDecodeFunc(object)) return;
                                        if (!["call", "apply"].includes(property.value)) debugger;
                                        let defuncMapName = object.object.callee.name;
                                        if (!needNumberFuncNames.includes(defuncMapName)) return;
                                        let result = global.runFunc(path.toString().replaceAll(`${defuncMapName}()`, `global.${defuncMapName}`), num);
                                        console.log(path.toString(), ' ===> ', result);
                                        path.replaceWith(types.stringLiteral(result));
                                    }
                                }
                            }
                        });
                    }
                }
            };

            // ----------------------------- 主流程 -----------------------------
            traverse(ast, find_sjs_se_global_subkey);
            if (!sjs_se_global_subkey_name || !find_10) {
                console.log('无法解密! sjs=', sjs_se_global_subkey_name, 'find_10=', find_10);
                return;
            }
            try {
                traverse(ast, findNumberList);

                eval(generator(ast).code); // 需要加载一下
                traverse(ast, restoreNumberList);

                let decodeFuncNames = collectDecodeFunc(ast);
                traverse(ast, handleSpecial);

                traverse(ast, diffDecodeFuncName);

                if (directFuncNames.length + needNumberFuncNames.length !== decodeFuncNames.length) {
                    console.log(`[restore-string] decode func 分类不完整: decode=${decodeFuncNames.length} direct=${directFuncNames.length} needNumber=${needNumberFuncNames.length}，继续部分还原`);
                }

                traverse(ast, simplifyTypeof);
                eval(generator(ast).code);
                traverse(ast, restoreInternal);
                traverse(ast, restoreSpecial);

                let astCode = generator(ast).code;

                eval(astCode);

                traverse(ast, restoreExternal);

                for (let path of newlyAddedList) {
                    path.remove();
                }
            } catch (e) {
                console.log('[restore-string] 中止:', e && e.message ? e.message : e);
                for (let p of newlyAddedList) {
                    try { if (p && !p.removed) p.remove(); } catch (_) {}
                }
            }
        }
    }
};

// ============================================================================
//  收尾还原（点号成员 / 字符串表 / wd 栈 / 分发包装 / 嵌套脚本）
// ============================================================================

function getStaticMemberName(node) {
    if (!types.isMemberExpression(node)) return null;
    if (types.isStringLiteral(node.property)) return node.property.value;
    if (types.isIdentifier(node.property) && !node.computed) return node.property.name;
    return null;
}

// -------- decode-hex-string：丢掉 extra.raw，让 generator 按明文输出 --------
const decodeHexString = {
    name: 'decode-hex-string',
    visitor: {
        StringLiteral(path) {
            if (path.node.extra) {
                delete path.node.extra;
            }
        }
    }
};

// -------- inline-constant-string-array：xYU[0] -> "length" --------
function getConstantStringArray(path, identName) {
    const binding = path.scope.getBinding(identName);
    if (!binding) return null;

    const asStringArray = (node) => {
        if (!types.isArrayExpression(node) || node.elements.length === 0) return null;
        if (!node.elements.every(el => types.isStringLiteral(el))) return null;
        return node.elements.map(el => el.value);
    };

    let values = null;
    if (binding.path.isVariableDeclarator()) {
        values = asStringArray(binding.path.node.init);
    }

    for (const writePath of binding.constantViolations) {
        if (!writePath.isAssignmentExpression() || writePath.node.operator !== '=') {
            return null;
        }
        const next = asStringArray(writePath.node.right);
        if (!next || values) return null;
        values = next;
    }

    if (!values) return null;

    for (const ref of binding.referencePaths) {
        const parent = ref.parentPath;
        if (!parent.isMemberExpression() || parent.node.object !== ref.node) continue;
        const prop = getStaticMemberName(parent.node);
        if (prop && /^(push|pop|shift|unshift|splice|sort|reverse)$/.test(prop)) {
            return null;
        }
    }

    return values;
}

const inlineConstantStringArray = {
    name: 'inline-constant-string-array',
    visitor: {
        MemberExpression: {
            exit(path) {
                const {node} = path;
                if (!node.computed || !types.isIdentifier(node.object) || !types.isNumericLiteral(node.property)) {
                    return;
                }
                if (path.parentPath.isAssignmentExpression() && path.parentKey === 'left') return;
                if (path.parentPath.isUpdateExpression()) return;

                const values = getConstantStringArray(path, node.object.name);
                if (!values) return;
                const index = node.property.value;
                if (index < 0 || index >= values.length) return;
                path.replaceWith(types.stringLiteral(values[index]));
            }
        }
    }
};

// -------- strip-wd-stack：叶子函数里只做 push/pop 的调用栈可以删 --------
function findStackName(programPath) {
    let name = null;
    programPath.traverse({
        AssignmentExpression(p) {
            if (!types.isIdentifier(p.node.left)) return;
            if (!p.toString().includes('sjs_se_global_subkey')) return;
            name = p.node.left.name;
            p.stop();
        }
    });
    return name;
}

function isStackMutateCall(node, stackName) {
    if (!types.isCallExpression(node)) return false;
    const {callee, arguments: args} = node;
    const method = getStaticMemberName(callee);
    if (!method || !types.isMemberExpression(callee) || !types.isIdentifier(callee.object, {name: stackName})) {
        return false;
    }
    if (method === 'push') return args.length === 1 && types.isNumericLiteral(args[0]);
    if (method === 'pop') return args.length === 0;
    if (method === 'splice') return args.length >= 2;
    return false;
}

function functionReadsStackValue(fnPath, stackName) {
    let reads = false;
    fnPath.traverse({
        Identifier(p) {
            if (p.node.name !== stackName || !p.isReferencedIdentifier()) return;
            const parent = p.parentPath;
            if (parent.isMemberExpression() && parent.node.object === p.node) {
                const method = getStaticMemberName(parent.node);
                if (method === 'push' || method === 'pop' || method === 'splice') return;
                if (method === 'length') {
                    const grand = parent.parentPath;
                    if (grand.isVariableDeclarator() || grand.isAssignmentExpression()) return;
                }
            }
            if (parent.isAssignmentExpression() && parent.node.left === p.node) return;
            reads = true;
            p.stop();
        }
    });
    return reads;
}

function functionHasUserCalls(fnPath, stackName) {
    let found = false;
    fnPath.traverse({
        Function(p) {
            if (p === fnPath) return;
            p.skip();
        },
        CallExpression(p) {
            if (isStackMutateCall(p.node, stackName)) return;
            const callee = p.get('callee');
            if (callee.isIdentifier()) {
                found = true;
                p.stop();
                return;
            }
            if (callee.isMemberExpression()) {
                const prop = getStaticMemberName(callee.node);
                if ((prop === 'apply' || prop === 'call') &&
                    types.isIdentifier(callee.node.object) &&
                    callee.node.object.name !== stackName &&
                    looksLikeOpcodeCall(p.node, prop)) {
                    found = true;
                    p.stop();
                }
            }
        }
    });
    return found;
}

const stripWdStack = {
    name: 'strip-wd-stack',
    visitor: {
        Program(path) {
            const stackName = findStackName(path) || 'wd';
            path.traverse({
                Function(fnPath) {
                    if (functionReadsStackValue(fnPath, stackName)) return;
                    if (functionHasUserCalls(fnPath, stackName)) return;

                    const removals = [];
                    fnPath.get('body').traverse({
                        Function(p) {
                            p.skip();
                        },
                        ExpressionStatement(p) {
                            if (isStackMutateCall(p.node.expression, stackName)) {
                                removals.push(p);
                            }
                        }
                    });
                    removals.reverse().forEach(p => {
                        if (!p.removed) p.remove();
                    });
                }
            });
        }
    }
};

// -------- inline-opcode-dispatch：Foo_N(N, [a, b]) -> Foo_N(a, b) --------
function looksLikeOpcodeCall(node, prop) {
    const args = node.arguments;
    if (prop === 'apply') {
        return args.length === 2 && types.isArrayExpression(args[1]) &&
            args[1].elements.length >= 1 && types.isNumericLiteral(args[1].elements[0]);
    }
    if (prop === 'call') {
        return args.length >= 2 && types.isNumericLiteral(args[1]);
    }
    return false;
}

function functionUsesThis(fnPath) {
    let used = false;
    fnPath.traverse({
        Function(p) {
            if (p !== fnPath) p.skip();
        },
        ThisExpression(p) {
            used = true;
            p.stop();
        }
    });
    return used;
}

function collectArgsUsage(fnPath, argsName) {
    const binding = fnPath.scope.getBinding(argsName);
    if (!binding || binding.constantViolations.length) return null;

    if (!binding.referencePaths.length) {
        return {mode: 'none', maxIndex: -1, aliases: new Map(), binding};
    }

    let maxIndex = -1;
    const aliases = new Map();

    for (const ref of binding.referencePaths) {
        const parent = ref.parentPath;
        if (!parent.isMemberExpression() || parent.node.object !== ref.node || !parent.node.computed) {
            return {mode: 'whole', maxIndex: -1, aliases: new Map(), binding};
        }
        if (!types.isNumericLiteral(parent.node.property)) {
            return {mode: 'whole', maxIndex: -1, aliases: new Map(), binding};
        }
        const index = parent.node.property.value;
        if (!Number.isInteger(index) || index < 0 || index > 32) return null;
        maxIndex = Math.max(maxIndex, index);

        const stmt = parent.parentPath;
        if (stmt.isVariableDeclarator() && types.isIdentifier(stmt.node.id) &&
            stmt.parentPath.isVariableDeclaration() && stmt.parentPath.node.declarations.length === 1) {
            if (!aliases.has(index)) aliases.set(index, stmt);
        }
    }

    return {mode: 'index', maxIndex, aliases, binding};
}

function describeOpcodeCall(refPath, expectedOpcode, mode) {
    let callPath = refPath.parentPath;
    let kind = 'direct';

    if (callPath.isMemberExpression() && callPath.parentPath.isCallExpression() &&
        callPath.node.object === refPath.node) {
        const prop = getStaticMemberName(callPath.node);
        if (prop !== 'apply' && prop !== 'call') return null;
        kind = prop;
        callPath = callPath.parentPath;
    } else if (!callPath.isCallExpression() || callPath.node.callee !== refPath.node) {
        return null;
    }

    const args = callPath.node.arguments;
    if (kind === 'direct') {
        if (args.length !== 2 || !types.isNumericLiteral(args[0], {value: expectedOpcode})) return null;
        if (mode === 'index' && !types.isArrayExpression(args[1])) return null;
        return {
            callPath,
            kind,
            elements: types.isArrayExpression(args[1]) ? args[1].elements : null,
            payload: args[1]
        };
    }

    if (kind === 'call') {
        if (args.length !== 3 || !types.isNumericLiteral(args[1], {value: expectedOpcode})) return null;
        if (mode === 'index' && !types.isArrayExpression(args[2])) return null;
        return {
            callPath,
            kind,
            thisArg: args[0],
            elements: types.isArrayExpression(args[2]) ? args[2].elements : null,
            payload: args[2]
        };
    }

    if (args.length !== 2 || !types.isArrayExpression(args[1]) || args[1].elements.length !== 2) {
        return null;
    }
    const [opcodeNode, rest] = args[1].elements;
    if (!types.isNumericLiteral(opcodeNode, {value: expectedOpcode})) return null;
    return {callPath, kind, thisArg: args[0], rest, payload: rest};
}

function rewriteOpcodeFunction(fnPath) {
    const {id, params} = fnPath.node;
    if (!id || params.length !== 2 || !types.isIdentifier(params[0]) || !types.isIdentifier(params[1])) {
        return;
    }

    const match = id.name.match(/_(\d+)$/);
    if (!match) return;
    const expectedOpcode = Number(match[1]);

    const opBinding = fnPath.scope.getBinding(params[0].name);
    if (opBinding && opBinding.referencePaths.length) return;

    const usage = collectArgsUsage(fnPath, params[1].name);
    if (!usage) return;

    const outerBinding = fnPath.parentPath.scope.getBinding(id.name);
    const innerBinding = fnPath.scope.getBinding(id.name);
    const refs = [];
    for (const binding of [outerBinding, innerBinding]) {
        if (!binding) continue;
        for (const ref of binding.referencePaths) {
            if (!refs.includes(ref)) refs.push(ref);
        }
    }

    const calls = [];
    for (const ref of refs) {
        if (ref.node === id) continue;
        const desc = describeOpcodeCall(ref, expectedOpcode, usage.mode);
        if (!desc) return;
        calls.push(desc);
    }

    let newParams;
    if (usage.mode === 'whole') {
        newParams = [types.identifier(params[1].name)];
    } else if (usage.mode === 'none') {
        newParams = [];
    } else {
        newParams = [];
        const usedNames = new Set();
        for (let i = 0; i <= usage.maxIndex; i++) {
            const alias = usage.aliases.get(i);
            let name;
            if (alias && types.isIdentifier(alias.node.id) && !usedNames.has(alias.node.id.name)) {
                name = alias.node.id.name;
            } else {
                name = fnPath.scope.generateUidIdentifier(`a${i}`).name;
            }
            usedNames.add(name);
            newParams.push(types.identifier(name));
        }
    }

    fnPath.node.params = newParams;
    const usesThis = functionUsesThis(fnPath);

    if (usage.mode === 'index') {
        for (const ref of [...usage.binding.referencePaths]) {
            const parent = ref.parentPath;
            if (!parent.node || !parent.isMemberExpression()) continue;
            const index = parent.node.property.value;
            parent.replaceWith(types.identifier(newParams[index].name));
        }

        for (const alias of usage.aliases.values()) {
            const decl = alias.parentPath;
            if (decl.removed || !decl.isVariableDeclaration() || decl.node.declarations.length !== 1) continue;
            const {id: aliasId, init} = decl.node.declarations[0];
            if (types.isIdentifier(aliasId) && types.isIdentifier(init) && aliasId.name === init.name) {
                decl.remove();
            }
        }
    }

    for (const {callPath, kind, thisArg, elements, rest, payload} of calls) {
        if (usage.mode === 'whole') {
            if (kind === 'direct') {
                callPath.node.arguments = [payload];
            } else if (kind === 'call') {
                callPath.node.arguments = [thisArg, payload];
            } else {
                callPath.node.callee = types.memberExpression(types.identifier(id.name), types.identifier('call'), false);
                callPath.node.arguments = [thisArg, payload];
            }
        } else if (usage.mode === 'none') {
            if (kind === 'direct' || !usesThis) {
                callPath.node.callee = types.identifier(id.name);
                callPath.node.arguments = [];
            } else {
                callPath.node.callee = types.memberExpression(types.identifier(id.name), types.identifier('call'), false);
                callPath.node.arguments = [thisArg];
            }
        } else if (kind === 'direct') {
            callPath.node.arguments = padCallArgs(elements, usage.maxIndex);
        } else if (kind === 'call') {
            callPath.node.arguments = [thisArg, ...padCallArgs(elements, usage.maxIndex)];
        } else if (rest) {
            callPath.node.arguments = [thisArg, rest];
        }
    }
}

function padCallArgs(elements, maxIndex) {
    const args = [];
    for (let i = 0; i <= maxIndex; i++) {
        args.push(elements[i] == null ? types.identifier('undefined') : elements[i]);
    }
    return args;
}

const inlineOpcodeDispatch = {
    name: 'inline-opcode-dispatch',
    visitor: {
        Program(path) {
            const fns = [];
            path.traverse({
                FunctionDeclaration(p) {
                    fns.push(p);
                }
            });
            fns.forEach(fn => {
                try {
                    rewriteOpcodeFunction(fn);
                } catch (e) {
                    Logger.info(`[inline-opcode-dispatch] 跳过 ${fn.node.id && fn.node.id.name}: ${e.message}`);
                }
            });
        }
    }
};

// -------- restore-dot-member：a["b"] -> a.b --------
const restoreDotMember = {
    name: 'restore-dot-member',
    visitor: {
        MemberExpression(path) {
            const {node} = path;
            if (!node.computed || !types.isStringLiteral(node.property)) return;
            const name = node.property.value;
            if (name === '__proto__' || !types.isValidIdentifier(name, false)) return;
            node.computed = false;
            node.property = types.identifier(name);
        }
    }
};

function looksLikeObfuscatedJs(str) {
    return typeof str === 'string' &&
        str.length > 400 &&
        str.length < 180000 &&
        /^function\s+[A-Za-z_$][\w$]*\s*\(/.test(str) &&
        (str.includes('apply(this,') || str.includes('["apply"]') || str.includes('.apply(this,'));
}

// -------- deobfuscate-nested-script：对嵌套的混淆脚本字符串再跑结构还原 --------
const deobfuscateNestedScript = {
    name: 'deobfuscate-nested-script',
    visitor: {
        StringLiteral(path) {
            const value = path.node.value;
            if (!looksLikeObfuscatedJs(value)) return;
            try {
                const inner = transformCodeWithStagedExecution(
                    value,
                    createStages({forNested: true}),
                    {createParenthesizedExpressions: true},
                    generatorOpts,
                    {tool: false, plugin: false}
                );
                if (inner && inner !== value) {
                    path.replaceWith(types.stringLiteral(inner));
                }
            } catch (e) {
                Logger.info(`[deobfuscate-nested-script] 跳过: ${e.message}`);
            }
        }
    }
};

function extractNamedIifeSource(src) {
    if (!src || !src.includes('0xe54db09')) return null;
    try {
        const ast = parser.parse(src, {sourceType: 'script'});
        let extracted = null;
        traverse(ast, {
            FunctionExpression(p) {
                const id = p.node.id;
                if (!id || id.name.length !== 10) return;
                let calleePath = p.parentPath.isParenthesizedExpression() ? p.parentPath : p;
                if (calleePath.parentPath.isCallExpression() && calleePath.parentPath.node.callee === calleePath.node) {
                    extracted = src.slice(p.node.start, p.node.end);
                    p.stop();
                }
            }
        });
        return extracted;
    } catch (e) {
        return null;
    }
}

function loadBmsOriginalIifeSource() {
    if (bmsOriginalIifeSource && bmsOriginalIifeSource.includes('0xe54db09')) {
        return bmsOriginalIifeSource;
    }
    const candidates = [
        typeof encodeFile === 'string' ? path.resolve(path.dirname(encodeFile), 'bms_input.js') : null,
        path.resolve(__dirname, 'bms_input.js'),
        path.resolve(process.cwd(), 'bms_input.js'),
    ].filter(Boolean);
    for (const file of candidates) {
        try {
            if (!fs.existsSync(file)) continue;
            const extracted = extractNamedIifeSource(fs.readFileSync(file, 'utf8'));
            if (extracted) {
                bmsOriginalIifeSource = extracted;
                return extracted;
            }
        } catch (e) {
        }
    }
    return bmsOriginalIifeSource;
}

function isLiteralishArg(node) {
    if (!node) return false;
    if (types.isNumericLiteral(node) || types.isBooleanLiteral(node) || types.isStringLiteral(node) || types.isNullLiteral(node)) {
        return true;
    }
    if (types.isIdentifier(node) && node.name === 'undefined') return true;
    if (types.isUnaryExpression(node) && (node.operator === '-' || node.operator === '+' || node.operator === '!') && isLiteralishArg(node.argument)) {
        return true;
    }
    return false;
}

function literalishToValue(node) {
    if (types.isNumericLiteral(node) || types.isBooleanLiteral(node) || types.isStringLiteral(node)) return node.value;
    if (types.isNullLiteral(node)) return null;
    if (types.isIdentifier(node) && node.name === 'undefined') return undefined;
    if (types.isUnaryExpression(node)) {
        const v = literalishToValue(node.argument);
        if (node.operator === '-') return -v;
        if (node.operator === '+') return +v;
        if (node.operator === '!') return !v;
    }
    return undefined;
}

function findOuterBmsIife(programPath) {
    for (const stmt of programPath.get('body')) {
        let expr = stmt.isExpressionStatement() ? stmt.get('expression') : stmt;
        if (!expr.isCallExpression()) continue;
        let callee = expr.get('callee');
        if (callee.isParenthesizedExpression()) callee = callee.get('expression');
        if (callee.isFunctionExpression() && callee.node.id && callee.node.id.name.length === 10) {
            return callee;
        }
    }
    return null;
}

function isSingletonFactoryDecl(node) {
    const id = node.id && node.id.name;
    if (!id || node.params.length !== 0) return false;
    const body = node.body && node.body.body;
    if (!body || body.length !== 3) return false;
    if (!types.isVariableDeclaration(body[0])) return false;
    if (!types.isExpressionStatement(body[1]) || !types.isAssignmentExpression(body[1].expression)) return false;
    if (!types.isIdentifier(body[1].expression.left, {name: id})) return false;
    return types.isReturnStatement(body[2]);
}

function collectSingletonFactories(programPath) {
    const names = [];
    const iife = findOuterBmsIife(programPath);
    const stmts = iife ? iife.get('body').get('body') : programPath.get('body');
    for (const stmt of stmts) {
        if (stmt.isFunctionDeclaration() && isSingletonFactoryDecl(stmt.node)) {
            names.push(stmt.node.id.name);
        }
    }
    return names;
}

function isFactoryCall(node, factoryNames) {
    return types.isCallExpression(node) &&
        types.isIdentifier(node.callee) &&
        factoryNames.has(node.callee.name) &&
        node.arguments.length === 0;
}

function getFactoryMethodCall(node, factoryNames) {
    if (!types.isCallExpression(node)) return null;
    let callee = node.callee;
    let kind = 'direct';
    let args = node.arguments;
    if (types.isMemberExpression(callee)) {
        const prop = getStaticMemberName(callee);
        if ((prop === 'call' || prop === 'apply') && types.isMemberExpression(callee.object)) {
            kind = prop;
            callee = callee.object;
        }
    }
    if (!types.isMemberExpression(callee)) return null;
    if (!isFactoryCall(callee.object, factoryNames)) return null;
    const method = getStaticMemberName(callee);
    if (!method || method === 'call' || method === 'apply') return null;
    const factory = callee.object.callee.name;
    if (kind === 'apply') {
        if (args.length !== 2 || !types.isArrayExpression(args[1])) return null;
        args = args[1].elements;
    } else if (kind === 'call') {
        args = args.slice(1);
    }
    if (!args.every(isLiteralishArg)) return null;
    return {factory, method, args: args.map(literalishToValue)};
}

function isTypeofFactoryProp(node, factoryNames) {
    if (!types.isUnaryExpression(node) || node.operator !== 'typeof') return null;
    const arg = node.argument;
    if (!types.isMemberExpression(arg) || !isFactoryCall(arg.object, factoryNames)) return null;
    const prop = getStaticMemberName(arg);
    if (!prop) return null;
    return {factory: arg.object.callee.name, prop};
}

function findVmStackTop(callPath, stackName) {
    const fn = callPath.getFunctionParent();
    if (!fn) return 354;
    let top = 354;
    const callStart = callPath.node.start;
    fn.traverse({
        Function(p) {
            if (p.node !== fn.node) p.skip();
        },
        CallExpression(p) {
            if (p === callPath) return;
            if (callStart != null && p.node.start != null && p.node.start >= callStart) return;
            if (!isStackMutateCall(p.node, stackName)) return;
            const method = getStaticMemberName(p.node.callee);
            if (method === 'push' && types.isNumericLiteral(p.node.arguments[0])) {
                top = p.node.arguments[0].value;
            } else if (method === 'splice') {
                const last = p.node.arguments[p.node.arguments.length - 1];
                if (types.isNumericLiteral(last)) top = last.value;
            }
        }
    });
    return top;
}

function makeBmsWindow() {
    const w = {
        String, Array, Object, Number, Boolean, Error, Math, JSON, Date, RegExp,
        parseInt, parseFloat, isNaN, isFinite, undefined,
        Uint8Array, ArrayBuffer, Promise, Symbol, Proxy, Map, Set, WeakMap,
        encodeURIComponent, decodeURIComponent, escape, unescape,
        Function, eval, console,
        navigator: {userAgent: 'Mozilla/5.0'},
        location: {href: 'https://example.com/'},
        document: {
            createElement() { return {setAttribute() {}, style: {}}; },
            body: {appendChild() {}},
            getElementById() { return null; },
            addEventListener() {},
            hasFocus() { return true; },
            dispatchEvent() {}
        }
    };
    w.window = w;
    w.global = w;
    w.globalThis = w;
    w.self = w;
    return w;
}

function rewriteN4ForSandbox(ast) {
    traverse(ast, {
        FunctionDeclaration(p) {
            if (!p.node.id) return;
            const src = p.toString();
            if (!src.includes('0xe54db09') || !src.includes('bQU') || !src.includes('substr')) return;
            if (p.node.params.length !== 0) return;
            const name = p.node.id.name;
            p.get('body').replaceWith(parser.parse(`function __bmsN4() {
                var yg = globalThis.__bmsIifeSrc;
                var marker = yg.indexOf("0xe54db09");
                var kwv = marker + 10;
                var semi = yg.indexOf(";", marker);
                var qqu = yg.substring(0, marker) + yg.substring(semi + 1) + "undefined";
                var qtU = yg.substring(kwv, semi) - bQU(qqu, 789099);
                ${name} = function () { return qtU; };
                return qtU;
            }`).program.body[0].body);
            p.stop();
        }
    });
}

function exposeBmsFactories(ast, factoryNames) {
    traverse(ast, {
        FunctionExpression(p) {
            const id = p.node.id;
            if (!id || id.name.length !== 10) return;
            let calleePath = p.parentPath.isParenthesizedExpression() ? p.parentPath : p;
            if (!(calleePath.parentPath.isCallExpression() && calleePath.parentPath.node.callee === calleePath.node)) {
                return;
            }
            p.traverse({
                Function(inner) {
                    if (inner.node !== p.node) inner.skip();
                },
                ReturnStatement(ret) {
                    const arg = ret.get('argument');
                    if (!arg.isCallExpression()) return;
                    if (getStaticMemberName(arg.node.callee) !== 'call') return;
                    const assigns = factoryNames.map(n => `try { globalThis.__bmsVm.${n} = ${n}; } catch (__e) {}`).join('\n');
                    ret.replaceWith(parser.parse(`{
                        try { ${generator(arg.node, {compact: true}).code}; }
                        catch (__bmsInitErr) { globalThis.__bmsInitErr = String(__bmsInitErr && __bmsInitErr.message); }
                        globalThis.__bmsVm = {};
                        ${assigns}
                        try { globalThis.__bmsNq = nq; } catch (__e) {}
                    }`).program.body[0]);
                }
            });
            p.stop();
        }
    });
}

function bootBmsStringVm(programPath, factoryNames) {
    const iifeSrc = loadBmsOriginalIifeSource();
    if (!iifeSrc) {
        Logger.info('[inline-bms-string-vm] 找不到原始 IIFE 源，跳过');
        return null;
    }
    const sandboxAst = parser.parse(generator(programPath.node, {compact: false, comments: false}).code, {
        sourceType: 'script',
        createParenthesizedExpressions: true,
    });
    traverse(sandboxAst, {
        CallExpression(p) {
            if (types.isIdentifier(p.node.callee) && /^eS1_xor_\d+_memo_array_init$/.test(p.node.callee.name)) {
                p.replaceWith(types.callExpression(types.identifier('BkV'), []));
            }
        }
    });
    rewriteN4ForSandbox(sandboxAst);
    exposeBmsFactories(sandboxAst, factoryNames);
    const code = generator(sandboxAst, {compact: false, comments: false}).code;
    const w = makeBmsWindow();
    w.__bmsIifeSrc = iifeSrc;
    const ctx = vm.createContext(Object.assign({window: w, global: w, globalThis: w, self: w, console}, w));
    try {
        vm.runInContext(code, ctx, {timeout: 20000});
    } catch (e) {
        Logger.info(`[inline-bms-string-vm] eval: ${e.message}`);
    }
    if (!w.__bmsVm || !Object.keys(w.__bmsVm).length) {
        Logger.info(`[inline-bms-string-vm] 工厂未导出 initErr=${w.__bmsInitErr || ''}，跳过`);
        return null;
    }
    Logger.info(`[inline-bms-string-vm] initErr=${w.__bmsInitErr || 'none'} factories=${Object.keys(w.__bmsVm).join(',')}`);
    const snapshots = {};
    const specials = new Set();
    for (const name of factoryNames) {
        let obj;
        try {
            const fac = w.__bmsVm[name];
            obj = typeof fac === 'function' ? fac() : null;
        } catch (e) {
            continue;
        }
        if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) continue;
        snapshots[name] = {};
        for (const key of Object.keys(obj)) {
            if (typeof obj[key] !== 'function') continue;
            snapshots[name][key] = obj[key];
            const src = Function.prototype.toString.call(obj[key]);
            if (/return \w+_\d+\.call\(this\)/.test(src)) {
                specials.add(`${name}.${key}`);
            }
        }
    }
    ctx.__bmsSnapshots = snapshots;
    const snapInfo = Object.entries(snapshots).map(([n, o]) => `${n}:${Object.keys(o).length}`).join(',');
    Logger.info(`[inline-bms-string-vm] snapshots=${snapInfo} nq=${Array.isArray(w.__bmsNq)} specials=${specials.size}`);
    return {ctx, w, snapshots, specials};
}

function looksLikeDecodedString(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 240) return false;
    return /^[\x09\x0a\x0d\x20-\x7e]*$/.test(value);
}

function evalFactoryMethod(boot, factory, method, args, stackTop) {
    if (boot.specials.has(`${factory}.${method}`)) return null;
    if (factory === 'BkV' || factory === 'm8V') return null;
    const fn = boot.snapshots[factory] && boot.snapshots[factory][method];
    if (typeof fn !== 'function') return null;
    boot.ctx.__vmFn = fn;
    boot.ctx.__vmArgs = args;
    boot.ctx.__vmTop = stackTop;
    const value = vm.runInContext(
        `(function(){ var s = globalThis.__bmsNq; if (!s) throw new Error("nq missing"); s.length = 0; s.push(__vmTop); return __vmFn.apply(null, __vmArgs); })()`,
        boot.ctx
    );
    return looksLikeDecodedString(value) ? value : null;
}

const fixBmsNameTableCalls = {
    name: 'fix-bms-name-table',
    visitor: {
        CallExpression(path) {
            const callee = path.node.callee;
            if (types.isIdentifier(callee) && /^eS1_xor_\d+_memo_array_init$/.test(callee.name)) {
                path.replaceWith(types.callExpression(types.identifier('BkV'), []));
            }
        }
    }
};

const inlineBmsStringVm = {
    name: 'inline-bms-string-vm',
    visitor: {
        Program(programPath) {
            const factoryNames = collectSingletonFactories(programPath);
            if (!factoryNames.length) {
                Logger.info('[inline-bms-string-vm] 未找到单例工厂');
                return;
            }
            const factorySet = new Set(factoryNames);
            const stackName = findStackName(programPath) || 'nq';
            const boot = bootBmsStringVm(programPath, factoryNames);
            if (!boot) return;

            let folded = 0;
            programPath.traverse({
                ConditionalExpression(p) {
                    const {test, consequent, alternate} = p.node;
                    let neg = false;
                    let bin = test;
                    if (types.isUnaryExpression(test) && test.operator === '!') {
                        neg = true;
                        bin = test.argument;
                    }
                    if (!types.isBinaryExpression(bin) || (bin.operator !== '===' && bin.operator !== '!==' && bin.operator !== '==' && bin.operator !== '!=')) {
                        return;
                    }
                    const typeofInfo = isTypeofFactoryProp(bin.left, factorySet) || isTypeofFactoryProp(bin.right, factorySet);
                    const other = isTypeofFactoryProp(bin.left, factorySet) ? bin.right : bin.left;
                    if (!typeofInfo || !types.isStringLiteral(other, {value: 'undefined'})) return;
                    const exists = boot.snapshots[typeofInfo.factory] && Object.prototype.hasOwnProperty.call(boot.snapshots[typeofInfo.factory], typeofInfo.prop);
                    let takeAlt = (bin.operator === '===' || bin.operator === '==') ? exists : !exists;
                    if (neg) takeAlt = !takeAlt;
                    p.replaceWith(takeAlt ? alternate : consequent);
                    folded++;
                }
            });

            const cache = new Map();
            let replaced = 0;
            let failed = 0;
            let sampleErr = '';
            programPath.traverse({
                CallExpression: {
                    exit(p) {
                        const info = getFactoryMethodCall(p.node, factorySet);
                        if (!info) return;
                        const top = findVmStackTop(p, stackName);
                        const key = `${info.factory}.${info.method}:${top}:${JSON.stringify(info.args)}`;
                        let value;
                        if (cache.has(key)) {
                            value = cache.get(key);
                        } else {
                            try {
                                value = evalFactoryMethod(boot, info.factory, info.method, info.args, top);
                                cache.set(key, value);
                            } catch (e) {
                                failed++;
                                if (!sampleErr) sampleErr = `${key} => ${e.message}`;
                                cache.set(key, null);
                                return;
                            }
                        }
                        if (typeof value !== 'string') {
                            failed++;
                            if (!sampleErr) sampleErr = `${key} => type=${typeof value}`;
                            return;
                        }
                        p.replaceWith(types.stringLiteral(value));
                        replaced++;
                    }
                }
            });
            Logger.info(`[inline-bms-string-vm] factories=${factoryNames.join(',')} fold=${folded} replace=${replaced} fail=${failed} sample=${sampleErr}`);
        }
    }
};

function createStages({forNested = false, cleanupOnly = false} = {}) {
    const cleanup = [
        fixBmsNameTableCalls,
        inlineBmsStringVm,
        decodeHexString,
        inlineConstantStringArray,
        stripWdStack,
        inlineOpcodeDispatch,
        restoreDotMember,
    ];
    if (!forNested) cleanup.push(deobfuscateNestedScript);

    if (cleanupOnly) {
        return [{type: 'once', plugins: cleanup}];
    }

    const stages = [
        {
            type: 'once',
            plugins: [
                bypassFormatCheck,
                splitMultiVariableDeclaration,
                standardizeStatementBlock,
                unifyMemberExpression,
                shiftForInit,
                resolveSequenceExpression,
            ]
        },
        {
            type: 'once',
            plugins: [
                clearJsFuck,
                replaceNumberLoop,
                removeBraceInCase,
                flattenControlFlow,
                clearFlowerInstructions,
                clearJsFuck
            ]
        },
    ];

    if (!forNested) {
        stages.push({
            type: 'once',
            plugins: [
                restoreString,
                restoreString,
            ]
        });
    }

    stages.push(
        {
            type: 'iterate',
            plugins: [removeAllDeadCode],
            terminateCondition: (prevCode, currentCode) => prevCode === currentCode
        },
        {
            type: 'once',
            plugins: cleanup
        },
        {
            type: 'iterate',
            plugins: [removeAllDeadCode],
            terminateCondition: (prevCode, currentCode) => prevCode === currentCode
        }
    );

    return stages;
}

// ============================================================================
//  驱动逻辑 
// ============================================================================

const cliArgs = process.argv.slice(2).filter(a => a !== '--cleanup-only');
const cleanupOnly = process.argv.includes('--cleanup-only');
const encodeFile = cliArgs[0] || (cleanupOnly ? './bms_output.js' : './bms_input.js');
const decodeFile = cliArgs[1] || './bms_output.js';

const generatorOpts = {
    compact: false,
    comments: false,
    jsescOption: {minimal: true}
};

if (require.main === module) {
    console.time("akamai混淆还原完毕，耗时");

    transformFileWithStagedExecution(
        encodeFile,
        createStages({cleanupOnly}),
        {
            createParenthesizedExpressions: true,
        },
        generatorOpts,
        decodeFile,
        {tool: true, plugin: false}
    );

    console.timeEnd("akamai混淆还原完毕，耗时");
}

module.exports = {
    transformCodeWithStagedExecution,
    createStages,
};
