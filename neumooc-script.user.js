// ==UserScript==
// @name         NEUMOOC 智能助手
// @namespace    http://tampermonkey.net/
// @version      1.2.5
// @description  NEUMOOC 智能助手，修复单页多题、悬浮球、拖动，并支持批量答题中断。
// @author       LuBanQAQ & Cokee
// @license      MIT
// @match        https://*.neumooc.com/*
// @match        http*://localhost/*
// @downloadURL  https://raw.githubusercontent.com/LuBanQAQ/neumooc-script/main/neumooc-script.user.js
// @updateURL    https://raw.githubusercontent.com/LuBanQAQ/neumooc-script/main/neumooc-script.user.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_getResourceText
// @require      https://cdn.jsdelivr.net/npm/sweetalert2@11
// @resource     sweetalert2_css https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css
// @connect      *
// ==/UserScript==
// Written by Gemini
(function () {
    "use strict";

    // =================================================================
    // 1. 基础配置与选择器
    // =================================================================
    const selectors = {
        questionBox: '.item-box[id^="question-"]:not([style*="display: none"])',
        questionTypeTag: '.question-type .el-tag__content',
        subQuestionBox: '.info-item.questions .preview-box',
        questionText: '.qusetion-info .info-item:first-child .value',
        subQuestionText: '.qusetion-info .info-item:first-child .value',
        optionLabel: '.el-radio, .el-checkbox',
        optionText: '.choices-html',
        mainQuestionText: '.qusetion-info.is-child-false .info-item:first-child .value',
        nextButton: '.next-question-btn, .left-bottom .el-button--primary span, .left-bottom .el-button--primary',
        prevButton: '.prev-question-btn, .left-bottom .el-button:not(.el-button--primary)',
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
        apiEndpoint: GM_getValue("apiEndpoint", "https://api.openai.com/v1/chat/completions"),
        model: GM_getValue("model", "gpt-3.5-turbo"),
        bulkPromptTemplate: GM_getValue("bulkPromptTemplate", defaultBulkPrompt)
    };

    let timeDelay = GM_getValue("timeDelay", 1500);
    let isAutoAnswering = false;
    let isBulkAnswering = false; // 新增：用于控制批量答题状态
    let currentQuestionIndex = 0;

    const savedPanelPos = JSON.parse(localStorage.getItem('neumooc_panel_pos')) || { top: 100, right: 20 };
    const savedBallPos = JSON.parse(localStorage.getItem('neumooc_ball_pos')) || { top: 100, right: 20 };

    // =================================================================
    // 2. GUI 界面构建
    // =================================================================
    GM_addStyle(`
        #control-panel {
            position: fixed;
            top: ${savedPanelPos.top}px;
            right: ${savedPanelPos.right}px;
            width: 340px;
            background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 100000;
            font-family:'Noto Sans SC', sans-serif; color: #333; font-size: 13px;
        }
        #control-panel-header { padding: 12px; cursor: grab; background: linear-gradient(90deg, #4facfe 0%, #00f2fe 100%); color: white; border-top-left-radius: 8px; border-top-right-radius: 8px; display: flex; justify-content: space-between; align-items: center; font-weight: bold; }
        #control-panel-body { padding: 15px; max-height: 75vh; overflow-y: auto; }
        #control-panel button { display: block; width: 100%; padding: 8px 12px; margin-bottom: 8px; border: 1px solid #ccc; border-radius: 4px; background-color: #fff; cursor: pointer; text-align: left; transition: all 0.2s; }
        #control-panel button:hover { background-color: #f0f0f0; transform: translateX(2px); }
        #control-panel .btn-primary { background-color: #4facfe; color: white; border: none; }
        #control-panel .btn-primary:hover { background-color: #00f2fe; color: #fff; }
        #control-panel .btn-danger { background-color: #ff6b6b; color: white; border: none; }
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

        #floating-ball {
            position: fixed;
            top: ${savedBallPos.top}px;
            right: ${savedBallPos.right}px;
            width: 40px; height: 40px; border-radius: 50%;
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            color: #fff; display: none; align-items: center; justify-content: center;
            box-shadow: 0 4px 10px rgba(0,0,0,0.2);
            z-index: 999999;
            cursor: grab;
            user-select: none; transition: transform 0.1s;
        }
        #floating-ball:active { transform: scale(0.95); cursor: grabbing; }
    `);

    const panel = document.createElement("div");
    panel.id = "control-panel";
    panel.innerHTML = `
        <div id="control-panel-header">
            <span>🎓 智能助手 v1.2.5</span>
            <span id="minimize-btn">➖</span>
        </div>
        <div id="control-panel-body">
            <div class="collapsible-header">⚙️ 参数配置</div>
            <div class="collapsible-content">
                <label>API Key:</label>
                <input type="text" id="api-key-input" placeholder="sk-..." type="password">
                <label>API Endpoint:</label>
                <input type="text" id="api-endpoint-input">
                <label>Model:</label>
                <input type="text" id="model-input">
                <label>操作延时(ms):</label>
                <input type="number" id="time-input" placeholder="1500">
                <button id="save-config-btn" class="btn-info">💾 保存基本配置</button>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 10px 0;">
                <label>批量提示词模板 ({{questions}} 为占位符):</label>
                <textarea id="bulk-prompt-input"></textarea>
                <button id="save-bulk-prompt-btn">💾 保存提示词</button>
            </div>

            <div class="collapsible-header">🛠️ 辅助工具</div>
            <div class="collapsible-content">
                <button id="copy-question-btn">📋 复制当前题目</button>
                <button id="finish-video-btn">🎬 尝试秒刷视频</button>
                <div style="display: flex; gap: 5px;">
                    <button id="test-prev-btn">◀️ 上一题</button>
                    <button id="test-next-btn">▶️ 下一题</button>
                </div>
            </div>

            <div id="question-info" style="font-size: 12px; color: #666; margin: 8px 0; font-weight: bold;"></div>

            <div style="display: flex; gap: 8px; margin-bottom: 5px;">
                <input type="number" id="single-question-number" placeholder="题号" style="width: 60px; margin-bottom:0;">
                <button id="ai-single-solve-btn" style="margin-bottom:0; flex:1;">🤖 解答指定单题</button>
            </div>

            <button id="answer-all-btn" class="btn-info" style="margin-top: 5px;">🧠 一键提取并答完本页所有题</button>
            <button id="full-auto-btn" class="btn-primary">⚡️ 开始全自动循环答题 (多页)</button>

            <div id="log-area">系统就绪...</div>
        </div>
    `;
    document.body.appendChild(panel);

    const floatingBall = document.createElement('div');
    floatingBall.id = 'floating-ball';
    floatingBall.innerHTML = '<span>❏</span>';
    document.body.appendChild(floatingBall);

    // 初始化输入框的值
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
    // 3. 通用辅助函数 (仅包含必要部分)
    // =================================================================

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const getRandomDelay = (base) => {
        if (!base) return Math.random() * 1000;
        return base + Math.random() * 900;
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
        return Array.from(combinationBox.querySelectorAll(selectors.subQuestionBox))
            .filter(sub => window.getComputedStyle(sub).display !== 'none');
    };

    const getSubQuestionType = (box) => {
        if (box.querySelector('.el-checkbox-group')) return 'multiple';
        if (box.querySelector('.el-radio-group')) {
            const txt = box.innerText;
            if (txt.includes('正确') && txt.includes('错误')) return 'judge';
            return 'single';
        }
        return 'unknown';
    };

    // =================================================================
    // 4. 核心功能: 选择与填空
    // =================================================================

    async function selectOptionByText(questionBox, answerLetters) {
        const options = Array.from(questionBox.querySelectorAll(selectors.optionLabel));
        if (options.length === 0) return false;

        let found = false;
        const lettersToClick = Array.isArray(answerLetters) ? answerLetters : [answerLetters];
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
                    if (isMultipleWithDelay) await wait(800);
                } else {
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

            let answers = answerText.split(/，|,|；|;|、/).map(a => a.trim()).filter(a => a);
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
                    log(`  - 填空[${i+1}]: ${val}`);
                    await wait(300);
                }
            }
            return true;
        } catch (e) {
            log(`  - 填空出错: ${e.message}`);
            return false;
        }
    }

    // =================================================================
    // 5. AI 请求与题目解析 (核心请求函数)
    // =================================================================

    const buildSinglePrompt = (questionText, options, isMultiple, isJudge, isBlank, context = "") => {
        let prompt = `你是一个严谨的答题助手。`;
        if (context) prompt += `\n背景材料：${context}\n`;
        prompt += `\n题目：${questionText}\n`;

        if (isBlank) {
            prompt += `这是一个填空题。请直接返回答案内容。如果有多个空，用中文逗号分隔。不要包含任何解释。`;
        } else {
            prompt += `选项：\n`;
            options.forEach((opt, i) => {
                prompt += `${String.fromCharCode(65 + i)}. ${opt}\n`;
            });
            if (isMultiple) prompt += `\n这是多选题，请返回所有正确选项字母，用逗号分隔（如 A,B）。`;
            else if (isJudge) prompt += `\n这是判断题，请返回正确选项字母（A或B）。`;
            else prompt += `\n这是单选题，请返回唯一正确选项字母。`;
        }
        return prompt;
    };

    const sendAiRequest = (prompt) => {
        return new Promise((resolve, reject) => {
            if (!aiConfig.apiKey) return reject("未配置 API Key");

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
                        // **批量答题中断检查点 1**
                        if (!isBulkAnswering && !isAutoAnswering) {
                            return reject("任务已被用户中断");
                        }

                        const data = JSON.parse(res.responseText);
                        const content = data.choices[0].message.content;
                        resolve(content);
                    } catch (e) { reject("解析响应失败: " + e.message); }
                },
                onerror: (e) => reject("网络请求失败: " + e.statusText)
            });
        });
    };

    const solveSingleQuestion = async (questionBox, isSub = false, context = "") => {
        const qTextEl = isSub ? questionBox.querySelector(selectors.subQuestionText) : (questionBox.querySelector(selectors.questionText) || questionBox.querySelector(selectors.subQuestionText));
        if (!qTextEl) return;

        const qText = qTextEl.innerText.trim();
        const isBlank = isBlankFillQuestion(questionBox) && !isSub;
        const optionsEl = Array.from(questionBox.querySelectorAll(selectors.optionLabel));
        const optionsText = optionsEl.map(opt => opt.querySelector(selectors.optionText)?.innerText.trim() || "");

        const type = getSubQuestionType(questionBox);
        const prompt = buildSinglePrompt(qText, optionsText, type === 'multiple', type === 'judge', isBlank, context);

        log(`💬 请求 AI (${qText.slice(0,10)}...)`);
        const aiRes = await sendAiRequest(prompt);
        log(`🤖 AI: ${aiRes}`);

        if (isBlank) {
            await fillBlankAnswers(questionBox, aiRes);
        } else {
            const letters = aiRes.replace(/[^A-Za-z,，]/g, "").replace(/，/g, ",").split(",").filter(s=>s);
            await selectOptionByText(questionBox, letters);
        }
    };

    // =================================================================
    // 6. 批量答题逻辑 (新增中断控制)
    // =================================================================

    const extractPageQuestions = () => {
        const allBoxes = Array.from(document.querySelectorAll('.item-box[id^="question-"]'));
        let extractedData = [];

        allBoxes.forEach((box, index) => {
            // ... (提取逻辑保持不变) ...
            if (isCombinationQuestion(box)) {
                const context = getMainQuestionText(box);
                const subQuestions = getSubQuestions(box);
                subQuestions.forEach((sub, subIdx) => {
                    const qText = sub.querySelector(selectors.subQuestionText)?.innerText.trim();
                    const options = Array.from(sub.querySelectorAll(selectors.optionLabel)).map((opt, i) => ({
                        letter: String.fromCharCode(65 + i),
                        text: opt.querySelector(selectors.optionText)?.innerText.trim()
                    }));
                    extractedData.push({
                        id: `comb_${index}_${subIdx}`,
                        type: getSubQuestionType(sub),
                        question: qText,
                        context: context,
                        options: options
                    });
                });
            } else if (isBlankFillQuestion(box)) {
                const qText = box.querySelector(selectors.questionText)?.innerText.trim();
                extractedData.push({
                    id: `blank_${index}`,
                    type: 'blank',
                    question: qText,
                    context: "填空题，请直接给出答案内容"
                });
            } else {
                const qText = box.querySelector(selectors.questionText)?.innerText.trim();
                const options = Array.from(box.querySelectorAll(selectors.optionLabel)).map((opt, i) => ({
                    letter: String.fromCharCode(65 + i),
                    text: opt.querySelector(selectors.optionText)?.innerText.trim()
                }));
                extractedData.push({
                    id: `norm_${index}`,
                    type: getSubQuestionType(box),
                    question: qText,
                    options: options
                });
            }
        });
        return extractedData;
    };

    const applyBulkAnswers = async (answerMap) => {
        const allBoxes = Array.from(document.querySelectorAll('.item-box[id^="question-"]'));

        for (let i = 0; i < allBoxes.length; i++) {
             // **批量答题中断检查点 2**
            if (!isBulkAnswering) {
                log("🔴 批量答案应用被用户中断。");
                return;
            }

            const box = allBoxes[i];
            if (isCombinationQuestion(box)) {
                const subs = getSubQuestions(box);
                for (let j = 0; j < subs.length; j++) {
                    if (!isBulkAnswering) { return; } // 二次检查
                    const id = `comb_${i}_${j}`;
                    const ans = answerMap[id];
                    if (ans) {
                        const letters = String(ans).replace(/[^A-Za-z,，]/g, "").replace(/，/g, ",").split(",").filter(Boolean);
                        log(`应用组合题[${i+1}-${j+1}]答案: ${letters}`);
                        await selectOptionByText(subs[j], letters);
                    }
                }
            } else if (isBlankFillQuestion(box)) {
                const id = `blank_${i}`;
                const ans = answerMap[id];
                if (ans) {
                    log(`应用填空题[${i+1}]答案: ${ans}`);
                    await fillBlankAnswers(box, String(ans));
                }
            } else {
                const id = `norm_${i}`;
                const ans = answerMap[id];
                if (ans) {
                    const letters = String(ans).replace(/[^A-Za-z,，]/g, "").replace(/，/g, ",").split(",").filter(Boolean);
                    log(`应用普通题[${i+1}]答案: ${letters}`);
                    await selectOptionByText(box, letters);
                }
            }
        }
    };

    // 批量答题启动/停止函数
    const bulkAnswerStop = () => {
        isBulkAnswering = false;
        const btn = document.getElementById('answer-all-btn');
        btn.innerText = "🧠 一键提取并答完本页所有题";
        btn.className = "btn-info";
        log("🔴 批量答题已停止。");
    };

    document.getElementById('answer-all-btn').addEventListener('click', async () => {
        const btn = document.getElementById('answer-all-btn');

        if (isBulkAnswering) {
            bulkAnswerStop();
            return;
        }

        try {
            isBulkAnswering = true;
            btn.innerText = "⏹️ 取消批量答题...";
            btn.className = "btn-danger";

            const questions = extractPageQuestions();
            if (questions.length === 0) throw new Error("未检测到题目");

            log(`📦 提取到 ${questions.length} 个子题目，正在发送给 AI...`);

            let prompt = aiConfig.bulkPromptTemplate;
            const jsonStr = JSON.stringify(questions, null, 2);
            prompt = prompt.replace('{{questions}}', jsonStr);

            const aiResRaw = await sendAiRequest(prompt);

            // **批量答题中断检查点 3**
            if (!isBulkAnswering) return;

            log("🤖 收到 AI 批量响应，正在解析...");

            let answersJson = null;
            try {
                const jsonMatch = aiResRaw.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    answersJson = JSON.parse(jsonMatch[0]);
                } else {
                    answersJson = JSON.parse(aiResRaw);
                }
            } catch (e) {
                throw new Error("AI 返回格式错误，无法解析为 JSON");
            }

            if (answersJson && isBulkAnswering) {
                await applyBulkAnswers(answersJson);
                if (isBulkAnswering) { // 成功完成
                    log("✅ 批量答题完成！");
                }
            }

        } catch (error) {
            if (error.message !== "任务已被用户中断") {
                 log(`❌ 批量答题失败: ${error.message}`);
            }
        } finally {
            bulkAnswerStop(); // 无论成功失败，都重置按钮
        }
    });

    // =================================================================
    // 7. 全自动循环模式 (保持不变)
    // =================================================================

    const questionNumInput = document.getElementById("single-question-number");

    questionNumInput.addEventListener('change', () => {
        const val = parseInt(questionNumInput.value);
        if (!isNaN(val) && val > 0) {
            currentQuestionIndex = val - 1;
            log(`✏️ 答题起始位置设为: 第 ${val} 题`);
        }
    });

    const updateQuestionInfoUI = (total, currentIdx) => {
        const info = document.getElementById("question-info");
        if (info) info.textContent = `当前: 第 ${currentIdx + 1} / ${total} 题`;

        if (document.activeElement !== questionNumInput) {
            questionNumInput.value = currentIdx + 1;
        }
    };

    const checkPageQuestions = () => {
        const allBoxes = document.querySelectorAll('.item-box[id^="question-"]');
        if (allBoxes.length > 0) {
            if (currentQuestionIndex >= allBoxes.length) {
                currentQuestionIndex = 0;
            }
            updateQuestionInfoUI(allBoxes.length, currentQuestionIndex);
        }
    };

    const observer = new MutationObserver(() => setTimeout(checkPageQuestions, 500));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

    async function autoLoopStep() {
        if (!isAutoAnswering) return;

        const allBoxes = Array.from(document.querySelectorAll(selectors.questionBox));

        if (allBoxes.length === 0) {
            log("⚠️ 未检测到题目，尝试下一页或停止");
            const nextBtn = document.querySelector(selectors.nextButton);
            if (nextBtn && !nextBtn.disabled && nextBtn.offsetParent !== null) {
                nextBtn.click();
                setTimeout(autoLoopStep, 3000);
            } else {
                isAutoAnswering = false;
                document.getElementById("full-auto-btn").innerText = "⚡️ 开始全自动循环答题";
                document.getElementById("full-auto-btn").className = "btn-primary";
                log("🏁 停止运行");
            }
            return;
        }

        if (currentQuestionIndex < allBoxes.length) {
            const currentBox = allBoxes[currentQuestionIndex];

            currentBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            log(`👉 正在处理第 ${currentQuestionIndex + 1} / ${allBoxes.length} 题`);

            try {
                 if (isCombinationQuestion(currentBox)) {
                    const context = getMainQuestionText(currentBox);
                    const subs = getSubQuestions(currentBox);
                    log(`   组合题包含 ${subs.length} 小题`);
                    for (const sub of subs) {
                        if(!isAutoAnswering) break;
                        await solveSingleQuestion(sub, true, context);
                        await wait(getRandomDelay(timeDelay * 0.8));
                    }
                } else {
                    await solveSingleQuestion(currentBox);
                }
            } catch (e) {
                log(`❌ 答题出错: ${e}`);
            }

            currentQuestionIndex++;
            updateQuestionInfoUI(allBoxes.length, currentQuestionIndex - 1);

            await wait(getRandomDelay(timeDelay));
            autoLoopStep();

        } else {
            log("📄 本页题目已处理完毕，尝试下一页...");
            const nextBtn = document.querySelector(selectors.nextButton);

            if (nextBtn && !nextBtn.disabled && nextBtn.offsetParent !== null) {
                nextBtn.click();
                currentQuestionIndex = 0;
                await wait(3000);
                autoLoopStep();
            } else {
                log("🏁 已到达最后一页，全自动停止");
                isAutoAnswering = false;
                document.getElementById("full-auto-btn").innerText = "⚡️ 开始全自动循环答题";
                document.getElementById("full-auto-btn").className = "btn-primary";
            }
        }
    }

    document.getElementById("full-auto-btn").addEventListener("click", () => {
        if (isAutoAnswering) {
            isAutoAnswering = false;
            document.getElementById("full-auto-btn").innerText = "⚡️ 开始全自动循环答题";
            document.getElementById("full-auto-btn").className = "btn-primary";
            log("🔴 已停止");
        } else {
            isAutoAnswering = true;
            document.getElementById("full-auto-btn").innerText = "⏹️ 停止全自动";
            document.getElementById("full-auto-btn").className = "btn-danger";

            const inputVal = parseInt(document.getElementById("single-question-number").value);
            if (!isNaN(inputVal) && inputVal > 0) {
                currentQuestionIndex = inputVal - 1;
            } else {
                currentQuestionIndex = 0;
            }

            log(`🟢 开始全自动循环... 从第 ${currentQuestionIndex + 1} 题开始`);
            autoLoopStep();
        }
    });

    document.getElementById("ai-single-solve-btn").addEventListener("click", async () => {
        const num = parseInt(document.getElementById("single-question-number").value);
        const allBoxes = Array.from(document.querySelectorAll('.item-box[id^="question-"]'));

        if (num > 0 && num <= allBoxes.length) {
            const targetBox = allBoxes[num - 1];
            targetBox.scrollIntoView({ behavior: 'smooth', block: 'center' });

            if (isCombinationQuestion(targetBox)) {
                const context = getMainQuestionText(targetBox);
                const subs = getSubQuestions(targetBox);
                for (const sub of subs) {
                    await solveSingleQuestion(sub, true, context);
                    await wait(1000);
                }
            } else {
                await solveSingleQuestion(targetBox);
            }
        } else {
            log("⚠️ 题号无效");
        }
    });

    // =================================================================
    // 8. UI 交互与拖动逻辑 (保持不变)
    // =================================================================

    document.getElementById("save-config-btn").addEventListener("click", () => {
        aiConfig.apiKey = document.getElementById("api-key-input").value.trim();
        aiConfig.apiEndpoint = document.getElementById("api-endpoint-input").value.trim();
        aiConfig.model = document.getElementById("model-input").value.trim();
        timeDelay = parseInt(document.getElementById("time-input").value) || 1500;

        GM_setValue("apiKey", aiConfig.apiKey);
        GM_setValue("apiEndpoint", aiConfig.apiEndpoint);
        GM_setValue("model", aiConfig.model);
        GM_setValue("timeDelay", timeDelay);
        log("✅ 基本配置已保存");
    });

    document.getElementById("save-bulk-prompt-btn").addEventListener("click", () => {
        aiConfig.bulkPromptTemplate = document.getElementById("bulk-prompt-input").value;
        GM_setValue("bulkPromptTemplate", aiConfig.bulkPromptTemplate);
        log("✅ Prompt 模板已保存");
    });

    document.querySelectorAll(".collapsible-header").forEach(h => {
        h.addEventListener("click", () => {
            h.classList.toggle("active");
            h.nextElementSibling.classList.toggle("visible");
        });
    });

    document.getElementById("minimize-btn").addEventListener("click", () => {
        panel.style.display = 'none';
        floatingBall.style.display = 'flex';
    });

    floatingBall.addEventListener("click", (e) => {
        if (floatingBall.classList.contains('dragging-active')) return;

        panel.style.display = 'block';
        floatingBall.style.display = 'none';

        panel.style.top = floatingBall.style.top;
        panel.style.right = floatingBall.style.right;
    });

    let isDragging = false, startX, startY, initialTop, initialRight, targetElement;

    const startDrag = (e, element) => {
        if (e.target.id === 'minimize-btn' || e.target.closest('button, input, textarea')) return;

        isDragging = true;
        targetElement = element;
        targetElement.classList.add('dragging-active');

        startX = e.clientX;
        startY = e.clientY;

        const rect = targetElement.getBoundingClientRect();
        initialTop = rect.top;
        initialRight = window.innerWidth - rect.right;

        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";

        document.addEventListener("mousemove", onDragging);
        document.addEventListener("mouseup", stopDrag);
    };

    const onDragging = (e) => {
        if (!isDragging || !targetElement) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        const newTop = initialTop + deltaY;
        const newRight = initialRight - deltaX;

        targetElement.style.top = `${newTop}px`;
        targetElement.style.right = `${newRight}px`;
    };

    const stopDrag = () => {
        if (!isDragging) return;

        isDragging = false;
        targetElement.classList.remove('dragging-active');
        document.body.style.userSelect = "auto";
        document.body.style.cursor = "default";

        const currentPos = {
            top: parseInt(targetElement.style.top),
            right: parseInt(targetElement.style.right)
        };

        if (targetElement.id === 'control-panel') {
            localStorage.setItem('neumooc_panel_pos', JSON.stringify(currentPos));
        } else if (targetElement.id === 'floating-ball') {
            localStorage.setItem('neumooc_ball_pos', JSON.stringify(currentPos));
        }

        document.removeEventListener("mousemove", onDragging);
        document.removeEventListener("mouseup", stopDrag);
    };

    document.getElementById("control-panel-header").addEventListener("mousedown", (e) => startDrag(e, panel));
    floatingBall.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        startDrag(e, floatingBall);
    });

    document.getElementById("copy-question-btn").addEventListener("click", () => {
        const box = document.querySelector(selectors.questionBox);
        if (box) {
             const txt = box.innerText;
             navigator.clipboard.writeText(txt).then(() => log("✅ 已复制到剪贴板"));
        } else {
            log("❌ 未找到题目");
        }
    });

    document.getElementById('finish-video-btn').addEventListener('click', async () => {
        const video = document.querySelector('video');
        if (!video) return log("❌ 未找到视频");
        log("⏳ 尝试跳过视频...");
        try {
            video.muted = true;
            video.currentTime = video.duration - 0.5;
            await video.play();
        } catch (e) { log("视频操作受限或失败"); }
    });

    document.getElementById("test-prev-btn").addEventListener("click", () => {
        const btn = document.querySelector(selectors.prevButton);
        if(btn) btn.click(); else log("未找到上一题按钮");
    });
    document.getElementById("test-next-btn").addEventListener("click", () => {
        const btn = document.querySelector(selectors.nextButton);
        if(btn) btn.click(); else log("未找到下一题按钮");
    });
})();
