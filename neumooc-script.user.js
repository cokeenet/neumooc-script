// ==UserScript==
// @name         NEUMOOC 智能助手
// @namespace    http://tampermonkey.net/
// @version      1.5.5
// @description  v1.5.5：修复主面板与悬浮球自动答题按钮的 ID 冲突和状态同步问题。
// @author       LuBanQAQ & Cokee & Gemini
// @license      MIT
// @match        https://*.neumooc.com/*
// @match        http*://localhost/*
// @downloadURL  https://raw.githubusercontent.com/cokeenet/neumooc-script/main/neumooc-script.user.js
// @updateURL  https://raw.githubusercontent.com/cokeenet/neumooc-script/main/neumooc-script.user.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_getResourceText
// @require      https://cdn.jsdelivr.net/npm/sweetalert2@11
// @resource     sweetalert2_css https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css
// @connect      *
// ==/UserScript==

(function () {

    "use strict";

    // =================================================================
    // 1. 基础配置与选择器
    // =================================================================
    const selectors = {
        questionBox: '.item-box[id^="question-"]',
        questionTypeTag: '.question-type .el-tag__content',
        subQuestionBox: '.info-item.questions .preview-box',
        questionText: '.qusetion-info .info-item:first-child .value',
        subQuestionText: '.qusetion-info .info-item:first-child .value',
        optionLabel: '.el-radio, .el-checkbox',
        optionText: '.choices-html',
        mainQuestionText: '.qusetion-info.is-child-false .info-item:first-child .value',
        nextButtonContainer: '.next-question-btn, .left-bottom, .question-btns, .course-btn-group',
        prevButtonContainer: '.prev-question-btn, .left-bottom, .question-btns, .course-btn-group',
        blankInputContainer: '.choices',
        blankInputField: '.el-input__inner, .wangEditorSign .w-e-text-container [contenteditable]'
    };

    const defaultBulkPrompt = `你是一个严谨的考试答题助手。下面提供一组题目的结构化 JSON 数据，请基于题目内容（含背景材料）推理正确答案。

请严格遵循以下 JSON 返回格式（不要包含 Markdown 代码块标记）：
{
  "题目ID": "答案内容"
}

规则：
1. **单选题 (single)**: 值为选项大写字母，如 "A"。
2. **多选题 (multiple)**: 值为大写字母数组或逗号分隔字符串，如 "A,B"。
3. **判断题 (judge)**: A 代表正确，B 代表错误。
4. **填空题 (blank)**: 值为填空内容的字符串。如果有多个空，用中文逗号 "，" 分隔。
5. **组合题**: JSON中已包含背景材料(context)，请结合背景作答。

题目数据：
{{questions}}`;

    // --- AI 配置 ---
    let aiConfig = {
        apiKey: GM_getValue("apiKey", ""),
        apiEndpoint: GM_getValue("apiEndpoint", "https://api.siliconflow.cn/v1/chat/completions"),
        model: GM_getValue("model", "deepseek-ai/DeepSeek-V3.2"),
        bulkPromptTemplate: GM_getValue("bulkPromptTemplate", defaultBulkPrompt)
    };

    let timeDelay = GM_getValue("timeDelay", 2500);
    let isAutoAnswering = false;
    let isBulkAnswering = false;
    let isSingleAnswering = false;
    let currentQuestionIndex = 0;
    let allQuestions = [];
    let consecutiveErrors = 0;

    // --- ETA 变量 ---
    let autoStartTime = 0;
    let answeredInCurrentLoop = 0;

    let etaMessage = "";
    const savedPanelPos = JSON.parse(localStorage.getItem('neumooc_panel_pos')) || { top: 100, right: 360 };
    const savedFloatingPos = JSON.parse(localStorage.getItem('neumooc_mini_pos')) || { top: 100, right: 20 };

    // =================================================================
    // 2. GUI 界面构建 (解决遮挡问题)
    // =================================================================
    GM_addStyle(`
        /* 极简隐蔽指示器 */
        #stealth-indicator {
            position: fixed;
            bottom: 2px; right: 2px;
            color: blue; font-family: Arial, sans-serif; font-size: 12px; font-weight: lighter;
            z-index: 2147483647;
            pointer-events: none; /* 关键：允许点击穿透 */
            display: block; /* 默认显示 */
            line-height: 1; text-shadow: 1px 1px 0 #fff;
            user-select: none;
        }

        /* 主控制面板 */
        #control-panel {
            /*position: fixed; top: ${savedPanelPos.top}px; right: ${savedPanelPos.right}px; width: 340px;*/
            position: fixed; top: 100px; right: 360px; width: 340px;
            background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 100000;
            font-family:'Noto Sans SC', sans-serif; color: #333; font-size: 13px;
            display: none; /* 默认隐藏 */
            pointer-events: auto; /* 自身可点击 */
        }
        #control-panel-header { padding: 12px; cursor: grab; background: linear-gradient(90deg, #4facfe 0%, #00f2fe 100%); color: white; border-top-left-radius: 8px; border-top-right-radius: 8px; display: flex; justify-content: space-between; align-items: center; font-weight: bold; }
        #control-panel-body { padding: 15px; max-height: 75vh; overflow-y: auto; }

        #control-panel button, #mini-toolbar button {
            display: block; width: 100%; padding: 8px 12px; margin-bottom: 8px;
            border: 1px solid #ccc; border-radius: 4px; background-color: #fff;
            cursor: pointer; text-align: center; transition: all 0.2s;
        }
        #control-panel button:hover, #mini-toolbar button:hover { background-color: #f0f0f0; transform: translateX(2px); }
        #control-panel .btn-primary, #mini-toolbar .btn-primary { background-color: #4facfe; color: white; border: none; }
        #control-panel .btn-danger, #mini-toolbar .btn-danger { background-color: #ff6b6b; color: white; border: none; }
        #control-panel .btn-info { background-color: #48c6ef; color: white; border: none; }

        #control-panel input[type="text"], #control-panel input[type="number"] { width: 100%; padding: 6px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        #control-panel textarea { width: 100%; padding: 6px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; resize: vertical; min-height: 80px; font-family: monospace; font-size: 12px; }
        #log-area { margin-top: 10px; padding: 8px; height: 120px; overflow-y: auto; background-color: #fff; border: 1px solid #eee; color: #555; font-size: 12px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word; border-radius: 4px; }
        #minimize-btn { cursor: pointer; padding: 4px 8px; font-size: 14px; }
        .collapsible-header { cursor: pointer; font-weight: bold; margin-top: 10px; padding-bottom: 5px; border-bottom: 1px solid #eee; user-select: none; display: flex; justify-content: space-between; }
        .collapsible-header::after { content: '▼'; font-size: 10px; transition: transform 0.2s; }
        .collapsible-header.active::after { transform: rotate(180deg); }
        .collapsible-content { display: none; padding-top: 10px; }
        .collapsible-content.visible { display: block; }
        .shortcut-hint { font-size: 11px; color: #888; margin-top: -5px; margin-bottom: 5px; text-align: right; }

        /* 悬浮球容器 (穿透修复) */
        #floating-ball-container {
            /*position: fixed; top: ${savedFloatingPos.top}px; right: ${savedFloatingPos.right}px;*/
            position: fixed; top: 100px; right: 20px;

            z-index: 999999; cursor: grab; user-select: none;
            display: none; /* 默认隐藏 */
            flex-direction: column; align-items: flex-end;
            pointer-events: none; /* 容器本身不挡鼠标 */
        }
        #floating-ball-container > * {
            pointer-events: auto; /* 子元素(按钮)可点击 */
        }

        #floating-ball { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.2); cursor: pointer; user-select: none; transition: transform 0.1s; margin-bottom: 5px; flex-shrink: 0; }
        #mini-toolbar { display: flex; align-items: center; background-color: rgba(255, 255, 255, 0.85); padding: 4px 8px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        #mini-toolbar button { padding: 4px 6px; margin: 0 2px; margin-bottom: 0; border-radius: 4px; font-size: 11px; height: 28px; width: auto !important; flex-shrink: 0; }
        #mini-toolbar #single-question-number { width: 40px; height: 28px; padding: 2px; text-align: center; margin: 0 5px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-size: 12px; }
        #question-info-mini { font-size: 11px; color: #666; margin-right: 8px; white-space: nowrap; }
        #mini-toolbar #mini-full-auto-btn { font-weight: bold; background-color: #4facfe; color: white; padding: 4px 10px; }
        #mini-toolbar #mini-full-auto-btn.btn-danger { background-color: #ff6b6b; }
    `);

    // --- 隐蔽指示器 ---
    const stealthIndicator = document.createElement("div");
    stealthIndicator.id = "stealth-indicator";
    document.body.appendChild(stealthIndicator);

    // --- 创建主控制面板 ---
    const panel = document.createElement("div");
    panel.id = "control-panel";
    panel.innerHTML = `
        <div id="control-panel-header">
            <span>🎓 智能助手 v1.5.5</span>
            <span id="minimize-btn">🔽</span>
        </div>
        <div id="control-panel-body">
        <div class="collapsible-header">📕 使用说明</div>
            <div class="collapsible-content">
               <div style="background:#f0f9ff; padding:8px; border-radius:4px; font-size:12px; color:#444;">
                <strong>⌨️ 键盘快捷键:</strong><br>
                <code style="color:#d63384">Ins</code>: 显示/隐藏 悬浮菜单<br>
                <code style="color:#d63384">Alt+1</code>: 自动答题 (Start/Stop)<br>
                <code style="color:#d63384">Alt+2</code>: 上一题<br>
                <code style="color:#d63384">Alt+3</code>: 下一题<br>
                <code style="color:#d63384">Alt+4</code>: 解答当前单题<br>
                <code style="color:#d63384">Ins/Alt+5</code>: 呼出/隐藏 配置面板<br>
                <code style="color:#d63384">Alt+6</code>: 批量解答本页<br>
                <code style="color:#d63384">Alt+7</code>: 复制当前题目<br>
            </div>
            </div>


            <div class="collapsible-header">⚙️ 参数配置</div>
            <div class="collapsible-content">
                <label>API Key:</label>
                <input type="text" id="api-key-input" placeholder="sk-..." >
                <label>API Endpoint:</label>
                <input type="text" id="api-endpoint-input">
                <label>Model:</label>
                <input type="text" id="model-input">
                <label>操作延时(ms):</label>
                <input type="number" id="time-input" placeholder="1500">
                <button id="save-config-btn" class="btn-info">💾 保存基本配置</button>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 10px 0;">
                <label>批量 Prompt:</label>
                <textarea id="bulk-prompt-input"></textarea>
                <button id="save-bulk-prompt-btn">💾 保存提示词</button>
            </div>

            <div class="collapsible-header active">🏃 自动答题控制</div>
            <div class="collapsible-content visible">
                <div id="question-info" style="font-size: 12px; color: #666; margin: 8px 0; font-weight: bold;">题号: -/-</div>
                <button id="main-full-auto-btn" class="btn-primary">▶️ 开始全自动答题</button>
                <button id="ai-single-solve-btn" class="btn-info">🤖 解答悬浮球指定题号单题</button>
                <button id="answer-all-btn" class="btn-info">🧠 一键提取并答完本页所有题</button>
            </div>

            <div class="collapsible-header">🛠️ 辅助工具</div>
            <div class="collapsible-content">
                <button id="copy-question-btn">📋 复制当前题目 (Alt+7)</button>
                <button id="finish-video-btn">🎬 秒刷当前视频</button>
                <button id="enable-all-buttons-btn" class="btn-primary">🔓 强制启用所有禁用按钮</button>
            </div>

            <div id="log-area">系统就绪...</div>
        </div>
    `;
    document.body.appendChild(panel);

    const floatingBallContainer = document.createElement('div');
    floatingBallContainer.id = 'floating-ball-container';
    document.body.appendChild(floatingBallContainer);

    const floatingBall = document.createElement('div');
    floatingBall.id = 'floating-ball';
    floatingBall.innerHTML = '<span>▫️</span>';
    floatingBallContainer.appendChild(floatingBall);

    const miniToolbar = document.createElement('div');
    miniToolbar.id = 'mini-toolbar';
    miniToolbar.innerHTML = `
        <span id="question-info-mini">题号: -/-</span>
        <input type="number" id="single-question-number" placeholder="题号" value="1">
        <button id="mini-full-auto-btn" class="btn-primary" title="快捷键: Alt+1">▶️ 自动</button>
        <button id="test-prev-btn">◀️</button>
        <button id="test-next-btn">▶️</button>
    `;
    floatingBallContainer.appendChild(miniToolbar);

    // 初始化输入框
    document.getElementById("api-key-input").value = aiConfig.apiKey;
    document.getElementById("api-endpoint-input").value = aiConfig.apiEndpoint;
    document.getElementById("model-input").value = aiConfig.model;
    document.getElementById("time-input").value = timeDelay;
    document.getElementById("bulk-prompt-input").value = aiConfig.bulkPromptTemplate;

    const log = (message) => {
        const logArea = document.getElementById("log-area");
        if (!logArea) return;
        const time = new Date().toLocaleTimeString();
        logArea.innerHTML += `<div><span style="color:#888">[${time}]</span> ${message}</div>`;
        logArea.scrollTop = logArea.scrollHeight;
    };

    // =================================================================
    // 3. 核心功能
    // =================================================================

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const getRandomDelay = (base) => {
        const randomAddition = Math.random() * 200;
        if (base === 0) return randomAddition;
        return base + randomAddition;
    };

    function enableAllDisabledButtons() {
        const disabledButtons = document.querySelectorAll(
            'button[disabled],[aria-disabled="true"], .is-disabled, .el-button.is-disabled'
        );
        let count = 0;
        disabledButtons.forEach(button => {
            if (button.hasAttribute('disabled')) { button.removeAttribute('disabled'); count++; }
            if (button.getAttribute('aria-disabled') === 'true') { button.removeAttribute('aria-disabled'); count++; }
            if (button.classList.contains('is-disabled')) { button.classList.remove('is-disabled'); count++; }
        });
        if (count > 0) log(`🔓 强制启用了 ${count} 个按钮/元素。`);
    }

    const findButtonByText = (containerSelector, text) => {
        const containers = document.querySelectorAll(containerSelector);
        for (const container of containers) {
            const buttons = container.querySelectorAll('.el-button, button, a[role="button"]');
            for (const btn of buttons) {
                if (btn.textContent.includes(text)) {
                    if (btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true' ||
                        btn.classList.contains('is-disabled') || window.getComputedStyle(btn).display === 'none') {
                        continue;
                    }
                    return btn;
                }
            }
        }
        return null;
    };

    const hasTagText = (questionBox, text) => {
        const tags = Array.from(questionBox.querySelectorAll(selectors.questionTypeTag));
        return tags.some(tag => tag.textContent.includes(text));
    };

    const isCombinationQuestion = (questionBox) => hasTagText(questionBox, "组合题");
    const isBlankFillQuestion = (questionBox) => hasTagText(questionBox, "填空题");

    const getMainQuestionText = (combinationBox) => {
        const mainTextEl = combinationBox.querySelector(selectors.mainQuestionText);
        return mainTextEl ? mainTextEl.innerText.trim() : "";
    };

    const getSubQuestions = (combinationBox) => {
        return Array.from(combinationBox.querySelectorAll(selectors.subQuestionBox));
    };

    const getSubQuestionType = (box) => {
        if (box.querySelector('.el-checkbox-group')) return 'multiple';
        if (box.querySelector('.el-radio-group')) {
            const options = box.querySelectorAll(selectors.optionLabel);
            const txt = box.innerText;
            if (options.length === 2 && (txt.includes('正确') || txt.includes('错误') || txt.includes('对') || txt.includes('错'))) {
                return 'judge';
            }
            return 'single';
        }
        return 'unknown';
    };

    async function selectOptionByText(questionBox, answerLetters) {
        const options = Array.from(questionBox.querySelectorAll(selectors.optionLabel));
        if (options.length === 0) return false;

        let found = false;
        const lettersToClick = Array.isArray(answerLetters) ? answerLetters : String(answerLetters).replace(/[^A-Za-z,]/g, "").toUpperCase().split(",").filter(Boolean);
        const isMultipleWithDelay = lettersToClick.length > 1;

        for (const letter of lettersToClick) {
            const upperLetter = letter.trim().toUpperCase();
            const index = upperLetter.charCodeAt(0) - 65;

            if (index >= 0 && index < options.length) {
                const targetOption = options[index];
                if (!targetOption.classList.contains("is-checked")) {
                    targetOption.click();
                    log(`  - 选中 ${upperLetter}`);
                    found = true;
                    if (isMultipleWithDelay && timeDelay > 500) await wait(800);
                } else {
                    log(`  - ${upperLetter} 已选中 (跳过)`);
                    found = true;
                }
            }
        }
        return found;
    }

    async function fillBlankAnswers(questionBox, answerText) {
        try {
            const blankContainers = Array.from(questionBox.querySelectorAll(selectors.blankInputContainer));
            if (blankContainers.length === 0) return false;

            let answers = answerText
                .split(/\|/) // 匹配竖杠分隔符
                .map(a => a.trim()) // 去除每个元素首尾空白
                .filter(a => a); // 过滤空字符串
            if (blankContainers.length === 1 && answers.length > 1) answers = [answerText];
            for (let i = 0; i < blankContainers.length; i++) {
                const inputField = blankContainers[i].querySelector(selectors.blankInputField);
                const val = answers[i] || answers[0] || "";

                if (inputField) {
                    if (inputField.isContentEditable) {
                        inputField.focus();
                        inputField.innerHTML = val;
                        inputField.dispatchEvent(new Event('input', { bubbles: true }));
                        inputField.dispatchEvent(new Event('blur', { bubbles: true }));
                    } else {
                        inputField.value = val;
                        inputField.dispatchEvent(new Event('input', { bubbles: true }));
                        inputField.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    log(`  - 填空[${i + 1}]: ${val}`);
                    await wait(100);
                }
            }
            return true;
        } catch (e) {
            log(`  - 填空出错: ${e.message}`);
            throw new Error(`填空出错`);
        }
    }

    const buildSinglePrompt = (questionText, options, type, context = "") => {
        let prompt = `你是一个严谨的考试答题助手。请根据以下题目和选项，找出最准确的答案。直接输出最终答案，不要包含任何解释。`;
        if (context) prompt += `\n背景材料：${context}\n`;
        prompt += `\n题目：${questionText}\n`;

        if (type === 'blank') {
            prompt += `这是一个填空题。请直接返回答案内容。如果有多个空，用英文竖杠 "|" 分隔。`;
        } else {
            prompt += `选项：\n`;
            if (options.length === 0) return log("无法解析选项。");
            options.forEach((opt, i) => { prompt += `${String.fromCharCode(65 + i)}. ${opt}\n`; });
            if (type === 'multiple') prompt += `\n注意：这是一个多选题，可能有一个或多个正确答案。请给出所有正确答案的字母，仅用逗号分隔（例如: A,B）。请只返回字母和逗号。`;
            else if (type === 'judge') prompt += `\n注意：这是一个判断题。选项A代表正确，B代表错误，请只返回唯一正确答案的字母（例如: A）。`;
            else prompt += `\n注意：这是一个单选题。请只返回唯一正确答案的字母（例如: A）。`;
        }
        return prompt;
    };

    const sendAiRequest = (prompt) => {
        return new Promise((resolve, reject) => {
            if (!aiConfig.apiKey) return reject(new Error("未配置 API Key"));
            log(prompt);
            GM_xmlhttpRequest({
                method: "POST",
                url: aiConfig.apiEndpoint,
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${aiConfig.apiKey}` },
                data: JSON.stringify({
                    model: aiConfig.model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0,
                }),
                onload: (res) => {
                    try {
                        if (!isBulkAnswering && !isAutoAnswering && !isSingleAnswering) return reject(new Error("任务已被用户中断"));
                        if (res.status !== 200) return reject(new Error(`API Error ${res.status}: ${res.responseText.slice(0, 50)}`));
                        const data = JSON.parse(res.responseText);
                        const content = data.choices[0].message.content.trim();
                        resolve(content);
                    } catch (e) {
                        reject(new Error("解析响应失败"));
                    }
                },
                onerror: (e) => reject(new Error("网络请求失败"))
            });
        });
    };

    const solveSingleQuestion = async (questionBox, isSub = false, context = "") => {
        const qTextEl = isSub
            ? questionBox.querySelector(selectors.subQuestionText)
            : (questionBox.querySelector(selectors.questionText) || questionBox.querySelector(selectors.subQuestionText));

        if (!qTextEl) { log("❌ 找不到题目文本，跳过。"); return; }

        const qText = qTextEl.innerText.trim();
        const type = isSub ? getSubQuestionType(questionBox) : (isBlankFillQuestion(questionBox) ? 'blank' : getSubQuestionType(questionBox));

        const optionsEl = Array.from(questionBox.querySelectorAll(selectors.optionLabel));
        const optionsText = optionsEl.map(opt => opt.querySelector(selectors.optionText)?.innerText.trim() || "");

        const prompt = buildSinglePrompt(qText, optionsText, type, context);
        log(`💬 请求 AI (${qText.slice(0, 10)}... | 类型: ${type})`);

        const aiRes = await sendAiRequest(prompt);
        log(`🤖 AI 答案: ${aiRes}`);

        if (type === 'blank') {
            await fillBlankAnswers(questionBox, aiRes);
        } else {
            const letters = aiRes.replace(/[^A-Za-z,，]/g, "").replace(/，/g, ",").split(",").filter(s => s);
            if (letters.length > 0) await selectOptionByText(questionBox, letters);
            else log("⚠️ AI返回无效");
        }
    };

    // =================================================================
    // 4. 批量答题逻辑
    // =================================================================

    const extractPageQuestions = () => {
        const allBoxesForBulk = Array.from(document.querySelectorAll(selectors.questionBox));
        let extractedData = [];

        allBoxesForBulk.forEach((box, index) => {
            const boxType = hasTagText(box, "组合题") ? 'combination' : (isBlankFillQuestion(box) ? 'blank' : getSubQuestionType(box));
            if (boxType === 'combination') {
                const context = getMainQuestionText(box);
                const subQuestions = getSubQuestions(box);
                subQuestions.forEach((sub, subIdx) => {
                    const qText = sub.querySelector(selectors.subQuestionText)?.innerText.trim();
                    const options = Array.from(sub.querySelectorAll(selectors.optionLabel)).map((opt, i) => ({
                        letter: String.fromCharCode(65 + i), text: opt.querySelector(selectors.optionText)?.innerText.trim()
                    }));
                    extractedData.push({ id: `comb_${index}_${subIdx}`, type: getSubQuestionType(sub), question: qText, context: context, options: options });
                });
            } else if (boxType === 'blank') {
                const qText = box.querySelector(selectors.questionText)?.innerText.trim();
                extractedData.push({ id: `blank_${index}`, type: 'blank', question: qText, context: "填空题，请直接给出答案内容" });
            } else {
                const qText = box.querySelector(selectors.questionText)?.innerText.trim();
                const options = Array.from(box.querySelectorAll(selectors.optionLabel)).map((opt, i) => ({
                    letter: String.fromCharCode(65 + i), text: opt.querySelector(selectors.optionText)?.innerText.trim()
                }));
                extractedData.push({ id: `norm_${index}`, type: boxType, question: qText, options: options });
            }
        });
        return extractedData;
    };

    const applyBulkAnswers = async (answerMap) => {
        const allBoxesForBulk = Array.from(document.querySelectorAll(selectors.questionBox));
        log("🔍 批量作答中...");

        for (let i = 0; i < allBoxesForBulk.length; i++) {
            if (!isBulkAnswering) return;
            const box = allBoxesForBulk[i];
            box.scrollIntoView({ behavior: 'smooth', block: 'center' });

            if (isCombinationQuestion(box)) {
                const subs = getSubQuestions(box);
                for (let j = 0; j < subs.length; j++) {
                    if (!isBulkAnswering) return;
                    const ans = answerMap[`comb_${i}_${j}`];
                    if (ans) await selectOptionByText(subs[j], String(ans).replace(/[^A-Za-z,]/g, "").split(","));
                }
            } else if (isBlankFillQuestion(box)) {
                const ans = answerMap[`blank_${i}`];
                if (ans) await fillBlankAnswers(box, String(ans));
            } else {
                const ans = answerMap[`norm_${i}`];
                if (ans) await selectOptionByText(box, String(ans).replace(/[^A-Za-z,]/g, "").split(","));
            }
            await wait(200);
        }
    };

    const bulkAnswerStop = () => {
        isBulkAnswering = false;
        const btn = document.getElementById('answer-all-btn');
        btn.innerText = "🧠 一键提取并答完本页所有题";
        btn.className = "btn-info";
    };

    document.getElementById('answer-all-btn').addEventListener('click', async () => {
        const btn = document.getElementById('answer-all-btn');
        if (isBulkAnswering) { bulkAnswerStop(); return; }
        if (!aiConfig.apiKey) { log("❌ 未配置 API Key"); return; }

        try {
            isBulkAnswering = true;
            btn.innerText = "⏹️ 取消批量...";
            btn.className = "btn-danger";

            const questions = extractPageQuestions();
            if (questions.length === 0) throw new Error("未检测到题目");
            log(`📦 提取到 ${questions.length} 题，请求 AI...`);

            let prompt = aiConfig.bulkPromptTemplate.replace('{{questions}}', JSON.stringify(questions, null, 2));
            const aiResRaw = await sendAiRequest(prompt);
            if (!isBulkAnswering) return;

            log("🤖 收到批量响应，解析中...");
            let answersJson = null;
            try {
                const jsonMatch = aiResRaw.match(/\{[\s\S]*\}/);
                answersJson = JSON.parse(jsonMatch ? jsonMatch[0] : aiResRaw);
            } catch (e) { throw new Error("JSON 解析失败"); }

            if (answersJson && isBulkAnswering) {
                await applyBulkAnswers(answersJson);
                if (isBulkAnswering) log("✅ 批量答题完成");
            }
        } catch (error) {
            if (error.message !== "任务已被用户中断") log(`❌ 批量失败: ${error.message}`);
        } finally {
            bulkAnswerStop();
        }
    });

    // =================================================================
    // 5. 全自动循环模式 (含修正)
    // =================================================================

    const questionNumInput = document.getElementById("single-question-number");

    // 获取两个不同的 full auto 按钮
    const mainAutoBtn = document.getElementById("main-full-auto-btn");
    const miniAutoBtn = document.getElementById("mini-full-auto-btn");

    const singleSolveBtn = document.getElementById("ai-single-solve-btn");
    const floatingBallContainerEl = document.getElementById("floating-ball-container");

    questionNumInput.addEventListener('change', () => {
        const val = parseInt(questionNumInput.value);
        if (!isNaN(val) && val > 0) {
            currentQuestionIndex = val - 1;
            checkPageQuestions();
            if (allQuestions.length > 0 && currentQuestionIndex < allQuestions.length) {
                allQuestions[currentQuestionIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    });

    const updateQuestionInfoUI = (total, currentIdx, etaMsg = "") => {
        const textMain = `题号: ${currentIdx + 1}/${total}${etaMsg}`;
        const infoMain = document.getElementById("question-info");
        if (infoMain) infoMain.textContent = textMain;
        const infoMini = document.getElementById("question-info-mini");
        if (infoMini && window.getComputedStyle(floatingBallContainerEl).display !== 'none') {
            infoMini.textContent = `题号: ${currentIdx + 1}/${total}`;
        }
        if (questionNumInput && document.activeElement !== questionNumInput && currentIdx < total) {
            questionNumInput.value = currentIdx + 1;
        }

        // --- 更新隐蔽指示器 ---
        if (stealthIndicator) {
            if (isAutoAnswering) {
                stealthIndicator.textContent = `A ${currentIdx + 1}/${total}`;
            } else if (isSingleAnswering) {
                stealthIndicator.textContent = `SI ${currentIdx + 1}/${total}`;
            } else if (isBulkAnswering) {
                stealthIndicator.textContent = `BU ${currentIdx + 1}/${total}`;
            } else {
                stealthIndicator.textContent = `- ${currentIdx + 1}/${total}`;
            }
        }
    };

    const checkPageQuestions = () => {
        allQuestions = Array.from(document.querySelectorAll(selectors.questionBox));
        const total = allQuestions.length;
        if (total > 0) {
            if (currentQuestionIndex >= total) currentQuestionIndex = total - 1;
            updateQuestionInfoUI(total, currentQuestionIndex, etaMessage);
        }
    };

    const observer = new MutationObserver(() => setTimeout(checkPageQuestions, 1000));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('load', () => setTimeout(checkPageQuestions, 1000));

    const handleNextQuestionOrStop = (totalQuestions) => {
        const nextBtn = findButtonByText(selectors.nextButtonContainer, "下一题") || findButtonByText(selectors.nextButtonContainer, "下一页");
        if (nextBtn) {
            log("➡️ 自动翻页...");
            nextBtn.click();
            currentQuestionIndex = 0;
            answeredInCurrentLoop = 0;
            autoStartTime = Date.now();
            return true;
        } else {
            log("✅ 本页完成 (无下一页按钮)");
            log("🏁 自动模式停止");
            stopAutoAnswering();
            return false;
        }
    };

    const turnPage = () => {

        const totalQuestions = allQuestions.length;
        const nextBtn = findButtonByText(selectors.nextButtonContainer, "下一题") || findButtonByText(selectors.nextButtonContainer, "下一页");
        if (nextBtn) {
            log("➡️ 自动翻页...");
            nextBtn.click();
            return true;
        } else if (currentQuestionIndex + 1 >= totalQuestions) {
            log("✅ 本页完成 (无下一页按钮)");
            log("🏁 自动模式停止");
            stopAutoAnswering();
            return false;
        }
    };

    async function autoLoopStep() {
        if (!isAutoAnswering) return;

        checkPageQuestions();
        const totalQuestions = allQuestions.length;

        // 页面无题或已处理完：尝试翻页
        if (totalQuestions === 0) {
            if (!handleNextQuestionOrStop(totalQuestions)) {
                if (totalQuestions === 0) {
                    log("⚠️ 未检测到题目，等待 3 秒重试...");
                    await wait(3000);
                    if (isAutoAnswering) autoLoopStep();
                }
                return;
            }
            log("⏳ 等待页面加载 (3s)...");
            await wait(3000);
            return autoLoopStep();
        }
        //答完了，停止
        if (currentQuestionIndex - 1 >= totalQuestions) {
            stopAutoAnswering();
            return false;
        }
        const currentBox = allQuestions[currentQuestionIndex];
        currentBox.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // ETA
        const questionsRemaining = totalQuestions - currentQuestionIndex;
        const elapsedTime = (Date.now() - autoStartTime) / 1000;
        if (answeredInCurrentLoop >= 1) {
            const avgTime = elapsedTime / answeredInCurrentLoop;
            const remaining = avgTime * questionsRemaining;
            etaMessage = ` | ${avgTime.toFixed(1)}s/题  | ETA ${(remaining / 60).toFixed(1)} 分`;
        }
        updateQuestionInfoUI(totalQuestions, currentQuestionIndex, etaMessage);
        log(`👉 处理第 ${currentQuestionIndex + 1} / ${totalQuestions} 题`);

        try {
            if (isCombinationQuestion(currentBox)) {
                const context = getMainQuestionText(currentBox);
                const subs = getSubQuestions(currentBox);
                for (const sub of subs) {
                    if (!isAutoAnswering) break;
                    await solveSingleQuestion(sub, true, context);
                    await wait(100);
                }
            } else {
                await solveSingleQuestion(currentBox);
            }
            consecutiveErrors = 0;
        } catch (e) {
            consecutiveErrors++;
            log(`❌ 出错: ${e.message}`);
            if (consecutiveErrors >= 3) {
                log("🛑 连续报错，自动停止。");
                stopAutoAnswering();
                return;
            }
        }

        currentQuestionIndex++;
        answeredInCurrentLoop++;

        let delayTime = getRandomDelay(timeDelay);
        log(`等待 ${(delayTime / 1000.0).toFixed(1)} s(基础 ${timeDelay / 1000.0} s)`);

        await wait(delayTime);
        autoLoopStep();
    }

    const stopAutoAnswering = () => {
        isAutoAnswering = false;
        mainAutoBtn.innerText = "▶️ 开始全自动答题";
        mainAutoBtn.className = "btn-primary";
        miniAutoBtn.innerText = "▶️ 自动";
        miniAutoBtn.className = "btn-primary";
        log("🔴 已停止");
        etaMessage = "";
    };

    const startAutoAnswering = () => {
        if (!aiConfig.apiKey) { log("❌ 请配置 API Key"); alert("请按 Alt+5 设置 API Key"); return; }
        checkPageQuestions();
        isAutoAnswering = true;

        mainAutoBtn.innerText = "⏹️ 停止 Auto";
        mainAutoBtn.className = "btn-danger";
        miniAutoBtn.innerText = "⏹️ 停止";
        miniAutoBtn.className = "btn-danger";

        const inputVal = parseInt(questionNumInput.value);
        currentQuestionIndex = (!isNaN(inputVal) && inputVal > 0) ? inputVal - 1 : 0;

        autoStartTime = Date.now();
        answeredInCurrentLoop = 0;
        consecutiveErrors = 0;
        log(`🟢 自动开始 (从第 ${currentQuestionIndex + 1} 题)`);
        autoLoopStep();
    };

    // 绑定事件处理器到两个不同的自动答题按钮
    const toggleAutoHandler = () => {
        if (isAutoAnswering) stopAutoAnswering(); else startAutoAnswering();
    };
    mainAutoBtn.addEventListener("click", toggleAutoHandler);
    miniAutoBtn.addEventListener("click", toggleAutoHandler);

    document.getElementById("ai-single-solve-btn").addEventListener("click", async () => {
        const num = parseInt(questionNumInput.value);
        checkPageQuestions();
        if (!aiConfig.apiKey) { log("❌ 无 API Key"); return; }
        if (!isSingleAnswering) isSingleAnswering = true;
        singleSolveBtn.innerText = "⏹️ 停止 Single";
        singleSolveBtn.className = "btn-danger";
        if (num > 0 && num <= allQuestions.length) {
            const targetBox = allQuestions[num - 1];
            currentQuestionIndex = num - 1;
            targetBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (isCombinationQuestion(targetBox)) {
                const subs = getSubQuestions(targetBox);
                log(`🤖 解答组合题[${num}]`);
                for (const sub of subs) await solveSingleQuestion(sub, true, getMainQuestionText(targetBox));
                isSingleAnswering = false;
                log(`✅ 解答组合题[${num}] 完成.`);
            } else {
                log(`🤖 解答单题[${num}]`);
                await solveSingleQuestion(targetBox);
                isSingleAnswering = false;
                log(`✅ 解答单题[${num}] 完成.`);
            }

            singleSolveBtn.innerText = "🤖 开始单题解答";
            singleSolveBtn.className = "btn-info";
        } else {
            log("⚠️ 题号无效");
        }
    });

    // =================================================================
    // 6. UI 交互 / 快捷键 / 拖动
    // =================================================================

    const togglePanelVisibility = () => {
        const isPanelVisible = panel.style.display !== 'none';
        const isMiniVisible = floatingBallContainer.style.display !== 'none';
        if (isPanelVisible || isMiniVisible) {
            // 如果有任何界面显示，则全部隐藏
            panel.style.display = 'none';
            floatingBallContainer.style.display = 'none';
            log("👻 界面已隐藏 (按 Ins 显示)");
        } else {
            // 如果全是隐藏的，则显示悬浮球
            floatingBallContainer.style.display = 'flex';
            log("👀 界面已显示");
        }
    };

    // 🆕 键盘快捷键监听
    document.addEventListener('keydown', (e) => {
        // Legacy: Insert 键切换 (完全保留)
        if (e.key === 'Insert' || e.keyCode === 45) {
            e.preventDefault();
            if (isAutoAnswering) stopAutoAnswering();
            if (isBulkAnswering) bulkAnswerStop();
            togglePanelVisibility();
            return;
        }

        // 隐蔽快捷键: Alt + 数字
        if (e.altKey) {
            switch (e.key) {
                case '1':
                    e.preventDefault();
                    if (isAutoAnswering) stopAutoAnswering(); else startAutoAnswering();
                    break;
                case '2':
                    e.preventDefault();
                    document.getElementById("test-prev-btn").click();
                    break;
                case '3':
                    e.preventDefault();
                    document.getElementById("test-next-btn").click();
                    break;
                case '4':
                    e.preventDefault();
                    document.getElementById("ai-single-solve-btn").click();
                    break;
                case '5':
                    e.preventDefault();
                    // Alt+5 用于直接呼出/隐藏主面板或悬浮球
                    togglePanelVisibility();
                    break;
                case '6':
                    e.preventDefault();
                    document.getElementById("answer-all-btn").click();
                    break;
                case '7':
                    e.preventDefault();
                    document.getElementById("copy-question-btn").click();
                    break;
            }
        }
    });

    document.getElementById("enable-all-buttons-btn").addEventListener("click", enableAllDisabledButtons);
    document.getElementById("save-config-btn").addEventListener("click", () => {
        aiConfig.apiKey = document.getElementById("api-key-input").value.trim();
        aiConfig.apiEndpoint = document.getElementById("api-endpoint-input").value.trim();
        aiConfig.model = document.getElementById("model-input").value.trim();
        timeDelay = Math.max(2500, parseInt(document.getElementById("time-input").value) || 0);
        GM_setValue("apiKey", aiConfig.apiKey);
        GM_setValue("apiEndpoint", aiConfig.apiEndpoint);
        GM_setValue("model", aiConfig.model);
        GM_setValue("timeDelay", timeDelay);
        log("✅ 配置已保存");
    });
    document.getElementById("save-bulk-prompt-btn").addEventListener("click", () => {
        aiConfig.bulkPromptTemplate = document.getElementById("bulk-prompt-input").value;
        GM_setValue("bulkPromptTemplate", aiConfig.bulkPromptTemplate);
        log("✅ Prompt 已保存");
    });
    document.querySelectorAll(".collapsible-header").forEach(h => {
        h.addEventListener("click", () => { h.classList.toggle("active"); h.nextElementSibling.classList.toggle("visible"); });
    });
    document.getElementById("minimize-btn").addEventListener("click", () => {
        // 点击最小化 => 隐藏面板，显示悬浮球
        const rect = panel.getBoundingClientRect();
        panel.style.display = 'none';

        // 将悬浮球放在当前面板的位置附近，确保在可视区域内
        const ballTop = Math.max(10, Math.min(rect.top, window.innerHeight - 58));
        const ballLeft = Math.max(10, Math.min(rect.left, window.innerWidth - 58));

        floatingBallContainer.style.top = `${ballTop}px`;
        floatingBallContainer.style.left = `${ballLeft}px`;
        floatingBallContainer.style.right = 'auto';
        floatingBallContainer.style.display = 'flex';
    });
    floatingBall.addEventListener("click", () => {
        if (floatingBallContainer.classList.contains('dragging-active')) {
            floatingBallContainer.classList.remove('dragging-active');
            return;
        }
        panel.style.top = floatingBallContainer.style.top;
        panel.style.right = floatingBallContainer.style.right;
        panel.style.display = 'block';
        floatingBallContainer.style.display = 'none';
    });

    // 拖动逻辑
    let isDragging = false, startX, startY, initialTop, initialRight, targetElement;
    const startDrag = (e, element, storageKey) => {
        if (element.id === 'control-panel' && e.target.closest('button, input, textarea, .collapsible-header, #minimize-btn')) return;
        // 只有当悬浮球显示时才允许拖动
        if (element.id === 'floating-ball-container' && (element.style.display === 'none' || e.target.closest('button, input'))) return;

        isDragging = true; targetElement = element; targetElement.classList.add('dragging-active');
        startX = e.clientX; startY = e.clientY;
        const rect = targetElement.getBoundingClientRect(); initialTop = rect.top; initialRight = window.innerWidth - rect.right;
        document.body.style.userSelect = "none"; document.body.style.cursor = "grabbing"; targetElement.dataset.storageKey = storageKey;
        document.addEventListener("mousemove", onDragging);
        document.addEventListener("mouseup", stopDrag);
    };
    const onDragging = (e) => {
        if (!isDragging || !targetElement) return;
        targetElement.style.top = `${initialTop + e.clientY - startY}px`;
        targetElement.style.right = `${initialRight - (e.clientX - startX)}px`;
    };
    const stopDrag = () => {
        if (!isDragging) return; isDragging = false;
        setTimeout(() => targetElement.classList.remove('dragging-active'), 100);
        document.body.style.userSelect = "auto"; document.body.style.cursor = "default";
        localStorage.setItem(targetElement.dataset.storageKey, JSON.stringify({ top: parseInt(targetElement.style.top), right: parseInt(targetElement.style.right) }));
        document.removeEventListener("mousemove", onDragging); document.removeEventListener("mouseup", stopDrag);
    };
    document.getElementById("control-panel-header").addEventListener("mousedown", (e) => startDrag(e, panel, 'neumooc_panel_pos'));
    floatingBallContainer.addEventListener("mousedown", (e) => { e.stopPropagation(); startDrag(e, floatingBallContainer, 'neumooc_mini_pos'); });

    document.getElementById("copy-question-btn").addEventListener("click", () => {
        const box = allQuestions[currentQuestionIndex];
        if (box) navigator.clipboard.writeText(box.innerText).then(() => log("✅ 已复制"));
    });
    document.getElementById('finish-video-btn').addEventListener('click', async () => {
        const video = document.querySelector('video');
        if (!video) return log("❌ 无视频");
        try { video.muted = true; video.currentTime = video.duration - 0.5; await video.play(); } catch (e) { }
    });
    document.getElementById("test-prev-btn").addEventListener("click", () => {
        checkPageQuestions();
        if (currentQuestionIndex > 0) { currentQuestionIndex--; allQuestions[currentQuestionIndex].scrollIntoView({ behavior: 'smooth', block: 'center' }); updateQuestionInfoUI(allQuestions.length, currentQuestionIndex); }
        else { const btn = findButtonByText(selectors.prevButtonContainer, "上一题") || findButtonByText(selectors.prevButtonContainer, "上一页"); if (btn) btn.click(); }
    });
    document.getElementById("test-next-btn").addEventListener("click", () => {
        checkPageQuestions();
        if (currentQuestionIndex < allQuestions.length - 1) { currentQuestionIndex++; allQuestions[currentQuestionIndex].scrollIntoView({ behavior: 'smooth', block: 'center' }); updateQuestionInfoUI(allQuestions.length, currentQuestionIndex); }
        else { const btn = findButtonByText(selectors.nextButtonContainer, "下一题") || findButtonByText(selectors.nextButtonContainer, "下一页"); if (btn) btn.click(); }
    });

    checkPageQuestions();
})();