// ==UserScript==
// @name         AI对话Prompt索引
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  为AI大模型聊天界面添加右侧prompt索引导航功能，支持悬停展开
// @author       You
// @match        https://www.qianwen.com/chat*
// @match        https://www.kimi.com/*
// @match        https://gemini.google.com/*
// @match        https://chatgpt.com/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 配置
    const CONFIG = {
        sidebarWidth: '280px',
        collapsedWidth: '40px',
        sidebarBg: '#f8f9fa',
        itemHeight: '40px',
        activeColor: '#4a90d9',
        hoverColor: '#e3f2fd',
        borderColor: '#e0e0e0',
        maxItems: 100,
        scrollOffset: 100,
        minTextLength: 2,
        maxTextLength: 80
    };

    // UI文本黑名单（用于过滤按钮、标签等非消息内容）
    const TEXT_BLACKLIST = [
        '发送', '复制', '点赞', '点踩', '重新生成', '停止生成',
        'send', 'copy', 'like', 'dislike', 'regenerate', 'stop',
        '分享', '编辑', '删除', '更多', '收起', '展开',
        'share', 'edit', 'delete', 'more', 'collapse', 'expand',
        '你说', 'You said'
    ];

    // 存储所有prompt信息
    let promptIndex = [];
    let currentActiveIndex = -1;
    let sidebarElement = null;
    let shadowRootContainer = null; // Shadow DOM容器

    // 生成元素定位器（用于重新查找元素）
    function createElementLocator(element, platform) {
        if (!element) return null;

        const locator = {
            platform: platform,
            textHash: null,
            dataAttributes: {},
            selector: null,
            index: -1
        };

        // 提取文本用于哈希
        const text = element.textContent || element.innerText || '';
        if (text) {
            // 使用前30个字符的简化哈希作为标识
            locator.textHash = text.trim().substring(0, 30).replace(/\s+/g, ' ');
        }

        // 收集data属性（Kimi等平台常用）
        if (element.dataset) {
            for (const key in element.dataset) {
                locator.dataAttributes[key] = element.dataset[key];
            }
        }

        // 特定平台的定位策略
        switch (platform) {
            case 'kimi':
                // Kimi使用data-msgid或类名+索引
                locator.selector = '.user-content';
                if (element.closest && element.closest('[data-msgid]')) {
                    locator.dataAttributes.msgid = element.closest('[data-msgid]').dataset.msgid;
                }
                break;
            case 'gemini':
                locator.selector = '.user-query-bubble-with-background, .query-text';
                break;
            case 'qianwen':
                locator.selector = '[class*="questionItem-"]';
                break;
            case 'chatgpt':
                locator.selector = '.user-message-bubble-color';
                break;
        }

        return locator;
    }

    // 根据定位器查找元素（调试版本）
    function findElementByLocator(locator, platform) {
        if (!locator) {
            console.log('[AI Prompt Index] findElementByLocator: locator 为空');
            return null;
        }

        const selector = locator.selector || getUserMessageSelector(platform);
        if (!selector) {
            console.log('[AI Prompt Index] findElementByLocator: 选择器为空');
            return null;
        }

        console.log('[AI Prompt Index] findElementByLocator: 使用选择器:', selector, '平台:', platform);

        // 获取所有候选元素
        const candidates = document.querySelectorAll(selector);
        console.log('[AI Prompt Index] findElementByLocator: 找到候选元素数量:', candidates.length);
        
        // 对于kimi平台，优先使用文本匹配（因为data-v-*是Vue组件标识，不是唯一标识）
        if(platform === 'kimi' && locator.textHash) {
            console.log('[AI Prompt Index] findElementByLocator: Kimi平台，优先尝试文本匹配，目标 textHash:', locator.textHash);
            for (let i = 0; i < candidates.length; i++) {
                const el = candidates[i];
                const elText = (el.textContent || el.innerText || '').trim().substring(0, 30).replace(/\s+/g, ' ');
                if (elText === locator.textHash) {
                    console.log('[AI Prompt Index] findElementByLocator: 通过文本找到元素，索引：', i);
                    return el;
                }
            }
        }
        // 其次通过data属性匹配（仅当 dataAttributes 包含 msgid 等唯一标识时才使用）
        const hasValidDataAttributes = locator.dataAttributes && locator.dataAttributes.msgid;
        if (hasValidDataAttributes && Object.keys(locator.dataAttributes).length > 0) {
            console.log('[AI Prompt Index] findElementByLocator: 尝试通过data属性匹配，目标 dataAttributes:', locator.dataAttributes);
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];

            // 检查data属性匹配
            let dataMatch = true;
            for (const key in locator.dataAttributes) {
                const targetValue = locator.dataAttributes[key];
                const actualValue = el.dataset ? el.dataset[key] : null;
                // 向上查找父元素
                const parentWithData = el.closest ? el.closest(`[data-${key}]`) : null;
                const parentValue = parentWithData ? parentWithData.dataset[key] : null;

                if (actualValue !== targetValue && parentValue !== targetValue) {
                    dataMatch = false;
                    break;
                }
            }

            if (dataMatch && Object.keys(locator.dataAttributes).length > 0) {
                // 找到了data属性匹配的元素
                const result = el.closest ? el.closest('[data-msgid]') || el : el;
                console.log('[AI Prompt Index] findElementByLocator: 通过data属性匹配找到元素，索引：', i);
                return result;
            }
        }
    }

        // 再次通过文本内容匹配（通用）
        if (locator.textHash) {
            console.log('[AI Prompt Index] findElementByLocator: 尝试文本匹配，目标  textHash:', locator.textHash);
            for (let i = 0; i < candidates.length; i++) {
                const el = candidates[i];
                const elText = (el.textContent || el.innerText || '').trim().substring(0, 30).replace(/\s+/g, ' ');
                
                if (elText === locator.textHash) {
                    console.log('[AI Prompt Index] findElementByLocator: 通过文本找到元素，索引:', i);
                    return el;
                }
            }
            
        }

        // 最后尝试通过索引匹配（最不精确，但总比没有好）
        console.log('[AI Prompt Index] findElementByLocator: 尝试索引匹配，目标 index:', locator.index, 'candidates 数量:', candidates.length);
        if (locator.index >= 0 && locator.index < candidates.length) {
            console.log('[AI Prompt Index] findElementByLocator: 通过索引找到元素，索引:', locator.index);
            return candidates[locator.index];
        }
        console.log('[AI Prompt Index] findElementByLocator: 未找到匹配的元素');
        return null;
    }

    // 添加样式
    GM_addStyle(`
        #ai-prompt-sidebar {
            position: fixed;
            right: 0;
            top: 50vh; /* 改为从屏幕中间开始，占据下半屏 */
            width: ${CONFIG.collapsedWidth};
            height: 50vh; /* 改为屏幕高度的一半 */
            background: ${CONFIG.sidebarBg};
            border-left: 1px solid ${CONFIG.borderColor};
            z-index: 99999;
            overflow: visible;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            transition: width 0.25s ease-out;
            box-shadow: -2px 0 8px rgba(0,0,0,0.05);
            cursor: move; /* 拖动光标 */
            user-select: none; /* 防止文本选中 */
        }

        #ai-prompt-sidebar.dragging {
            cursor: grabbing !important;
            transition: none !important; /* 拖动时禁用动画 */
        }

        #ai-prompt-sidebar:hover {
            width: ${CONFIG.sidebarWidth};
        }

        #ai-prompt-sidebar .sidebar-content {
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.2s ease-out 0.05s, visibility 0.2s ease-out 0.05s;
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        #ai-prompt-sidebar:hover .sidebar-content {
            opacity: 1;
            visibility: visible;
        }

        /* 收起状态的圆点导航 */
        #ai-prompt-sidebar .collapsed-dots {
            position: absolute;
            right: 0;
            top: 0;
            width: ${CONFIG.collapsedWidth};
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 12px 0;
            gap: 8px;
            overflow-y: auto;
            overflow-x: hidden;
            transition: opacity 0.15s ease-out;
        }

        #ai-prompt-sidebar:hover .collapsed-dots {
            opacity: 0;
            pointer-events: none;
        }

        .prompt-dot {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: #e0e0e0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 600;
            color: #666;
            cursor: pointer;
            transition: all 0.2s;
            flex-shrink: 0;
        }

        .prompt-dot:hover {
            background: ${CONFIG.hoverColor};
            transform: scale(1.1);
        }

        .prompt-dot.active {
            background: ${CONFIG.activeColor};
            color: white;
        }

        .prompt-sidebar-header {
            position: sticky;
            top: 0;
            background: ${CONFIG.sidebarBg};
            padding: 16px;
            border-bottom: 1px solid ${CONFIG.borderColor};
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 10;
            flex-shrink: 0;
        }

        .prompt-sidebar-title {
            font-size: 14px;
            font-weight: 600;
            color: #333;
            margin: 0;
        }

        .prompt-sidebar-count {
            font-size: 12px;
            color: #666;
            background: #e0e0e0;
            padding: 2px 8px;
            border-radius: 12px;
        }

        .prompt-list {
            padding: 8px 0;
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
        }

        .prompt-item {
            padding: 12px 16px;
            cursor: pointer;
            border-left: 3px solid transparent;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .prompt-item:hover {
            background: ${CONFIG.hoverColor};
        }

        .prompt-item.active {
            background: ${CONFIG.hoverColor};
            border-left-color: ${CONFIG.activeColor};
        }

        .prompt-number {
            min-width: 24px;
            height: 24px;
            background: #e0e0e0;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 600;
            color: #666;
            flex-shrink: 0;
        }

        .prompt-item.active .prompt-number {
            background: ${CONFIG.activeColor};
            color: white;
        }

        .prompt-text {
            font-size: 13px;
            color: #333;
            line-height: 1.4;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            word-break: break-all;
        }

        .prompt-item:hover .prompt-text {
            color: ${CONFIG.activeColor};
        }

        .prompt-empty {
            padding: 40px 20px;
            text-align: center;
            color: #999;
            font-size: 13px;
        }

        .prompt-actions {
            position: sticky;
            bottom: 0;
            background: ${CONFIG.sidebarBg};
            padding: 12px 16px;
            border-top: 1px solid ${CONFIG.borderColor};
            display: flex;
            gap: 8px;
            flex-shrink: 0;
        }

        .prompt-action-btn {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid ${CONFIG.borderColor};
            background: white;
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
            color: #666;
        }

        .prompt-action-btn:hover {
            background: ${CONFIG.hoverColor};
            border-color: ${CONFIG.activeColor};
            color: ${CONFIG.activeColor};
        }

        /* 滚动条样式 */
        #ai-prompt-sidebar .prompt-list::-webkit-scrollbar,
        #ai-prompt-sidebar .collapsed-dots::-webkit-scrollbar {
            width: 4px;
        }

        #ai-prompt-sidebar .prompt-list::-webkit-scrollbar-track,
        #ai-prompt-sidebar .collapsed-dots::-webkit-scrollbar-track {
            background: transparent;
        }

        #ai-prompt-sidebar .prompt-list::-webkit-scrollbar-thumb,
        #ai-prompt-sidebar .collapsed-dots::-webkit-scrollbar-thumb {
            background: #ccc;
            border-radius: 2px;
        }

        #ai-prompt-sidebar .prompt-list::-webkit-scrollbar-thumb:hover,
        #ai-prompt-sidebar .collapsed-dots::-webkit-scrollbar-thumb:hover {
            background: #aaa;
        }
    `);

    // 检测当前平台
    function detectPlatform() {
        const host = window.location.hostname;
        if (host.includes('qianwen')) return 'qianwen';
        if (host.includes('kimi')) return 'kimi';
        if (host.includes('gemini')) return 'gemini';
        if (host.includes('chatgpt') || host.includes('openai')) return 'chatgpt';
        return 'unknown';
    }

    // 获取用户消息选择器 - 基于实际HTML结构
    function getUserMessageSelector(platform) {
        const selectors = {
            // 通义千问: 使用实际观察到的类名
            'qianwen': '.questionItem-MPmrIl, [class^="questionItem-"], [class*="questionItem-"]',
            // Kimi: 使用user-content类
            'kimi': '.user-content, [class*="user-content"]',
            // Gemini: 使用user-query相关类
            'gemini': '.user-query-bubble-with-background, .query-text, [class*="user-query"]',
            // ChatGPT: 使用user-message-bubble-color类
            'chatgpt': '.user-message-bubble-color, [class*="user-message-bubble"]'
        };
        return selectors[platform] || '';
    }

    // 获取文本内容选择器 - 用于从容器中提取实际文本
    function getTextContentSelector(platform) {
        const selectors = {
            // 通义千问: bubble内的文本
            'qianwen': '.bubble-uo23is, [class^="bubble-"], [class*="bubble-"]',
            // Kimi: user-content直接包含文本
            'kimi': '',
            // Gemini: query-text内的p标签
            'gemini': '.query-text p, .query-text',
            // ChatGPT: whitespace-pre-wrap div
            'chatgpt': '.whitespace-pre-wrap'
        };
        return selectors[platform] || '';
    }

    // 验证元素是否有效
    function isValidUserMessage(element, platform) {
        if (!element) return false;

        // 排除明显的非消息元素
        const tagName = element.tagName.toLowerCase();
        if (['button', 'input', 'textarea', 'svg', 'path', 'script', 'style'].includes(tagName)) {
            return false;
        }

        // 检查元素是否可见
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }

        // 检查最小尺寸
        const rect = element.getBoundingClientRect();
        if (rect.width < 30 || rect.height < 10) {
            return false;
        }

        return true;
    }

    // 过滤黑名单文本
    function isBlacklistedText(text) {
        const lowerText = text.toLowerCase().trim();
        return TEXT_BLACKLIST.some(keyword =>
            lowerText === keyword.toLowerCase() ||
            lowerText.startsWith(keyword.toLowerCase())
        );
    }

    // 清理文本
    function cleanText(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/^你说\s*/i, '')
            .replace(/^You said\s*/i, '')
            .trim();
    }

    // 提取消息文本
    function extractMessageText(element, platform) {
        if (!element) return '';

        let text = '';
        const textSelector = getTextContentSelector(platform);

        // 如果有特定的文本选择器，优先使用
        if (textSelector) {
            const textElements = element.querySelectorAll(textSelector);
            if (textElements.length > 0) {
                text = Array.from(textElements)
                    .map(el => el.textContent || el.innerText || '')
                    .join(' ');
            }
        }

        // 如果没有找到文本，使用元素自身的文本
        if (!text) {
            // 克隆元素以避免修改原始DOM
            const clone = element.cloneNode(true);

            // 移除按钮、图标等无关元素
            const removeSelectors = ['button', 'svg', 'script', 'style', '[class*="icon"]', '[data-role="icon"]'];
            removeSelectors.forEach(sel => {
                const elems = clone.querySelectorAll(sel);
                elems.forEach(el => el.remove());
            });

            text = clone.textContent || clone.innerText || '';
        }

        // 清理文本
        text = cleanText(text);

        // 检查是否在黑名单中
        if (isBlacklistedText(text)) {
            return '';
        }

        // 检查最小长度
        if (text.length < CONFIG.minTextLength) {
            return '';
        }

        // 限制最大长度
        if (text.length > CONFIG.maxTextLength) {
            text = text.substring(0, CONFIG.maxTextLength) + '...';
        }

        return text;
    }

    // 加载所有历史消息（针对千问页面的虚拟滚动）
    async function loadAllMessages(platform) {
        if (platform !== 'qianwen') return; // 只处理千问页面

        console.log('[AI Prompt Index] 开始加载所有历史消息...');

        const selector = getUserMessageSelector(platform);
        console.log('[AI Prompt Index] 使用选择器:', selector);

        // 先等待页面基本内容加载
        await new Promise(resolve => setTimeout(resolve, 1500));

        // 首次检查
        let messages = document.querySelectorAll(selector);
        console.log('[AI Prompt Index] 初始消息数量:', messages.length);

        // 如果初始就有消息，说明页面已经加载完成，直接返回
        if (messages.length > 0) {
            console.log('[AI Prompt Index] 已有消息，开始滚动加载历史消息...');
        } else {
            console.log('[AI Prompt Index] 尚未找到消息，等待更长时间...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            messages = document.querySelectorAll(selector);
            console.log('[AI Prompt Index] 等待后消息数量:', messages.length);
        }

        let lastCount = 0;
        let maxAttempts = 20; // 增加最大尝试次数
        let attempts = 0;
        let consecutiveNoChange = 0; // 连续无变化次数

        while (attempts < maxAttempts) {
            const currentCount = document.querySelectorAll(selector).length;
            console.log(`[AI Prompt Index] 第${attempts + 1}次尝试，当前消息数量：${currentCount}`);

            // 找到滚动容器
            const scrollContainer = document.querySelector('.message-list-scroll-container') ||
                                    document.querySelector('[class*="scrollContainer"]') ||
                                    document.querySelector('[class*="messageList"]') ||
                                    document.querySelector('[class*="chatList"]') ||
                                    document.querySelector('[class*="content"]') ||
                                    document.documentElement;

            // 滚动到底部再返回顶部，触发历史消息加载
            if (scrollContainer !== document.documentElement) {
                // 先记录当前滚动位置
                const originalScrollTop = scrollContainer.scrollTop;
                // 滚动到底部
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
                await new Promise(resolve => setTimeout(resolve, 500));
                // 滚动到顶部
                scrollContainer.scrollTop = 0;
                await new Promise(resolve => setTimeout(resolve, 800));
                // 恢复原始滚动位置
                scrollContainer.scrollTop = originalScrollTop;
            } else {
                // 如果是 documentElement，使用 window 滚动
                const originalScrollY = window.scrollY;
                window.scrollTo(0, document.body.scrollHeight);
                await new Promise(resolve => setTimeout(resolve, 500));
                window.scrollTo(0, 0);
                await new Promise(resolve => setTimeout(resolve, 800));
                window.scrollTo(0, originalScrollY);
            }

            // 检查是否有新消息
            const newMessages = document.querySelectorAll(selector);
            if (newMessages.length === currentCount) {
                consecutiveNoChange++;
                console.log(`[AI Prompt Index] 连续${consecutiveNoChange}次无变化`);
                if (consecutiveNoChange >= 2 && currentCount > 0) {
                    console.log('[AI Prompt Index] 没有新消息，加载完成');
                    break;
                }
            } else {
                consecutiveNoChange = 0;
                console.log(`[AI Prompt Index] 发现新消息，当前总数：${newMessages.length}`);
            }

            lastCount = newMessages.length;
            attempts++;
        }

        console.log('[AI Prompt Index] 历史消息加载完成，最终消息数量:', lastCount);
    }

    // 扫描页面中的用户消息
    function scanMessages() {
        const platform = detectPlatform();
        console.log('[AI Prompt Index] 扫描平台:', platform);

        const selector = getUserMessageSelector(platform);
        if (!selector) {
            console.log('[AI Prompt Index] 未知平台，跳过扫描');
            return;
        }

        console.log('[AI Prompt Index] 使用选择器:', selector);

        // 查找所有匹配的元素
        const messages = document.querySelectorAll(selector);
        console.log('[AI Prompt Index] 找到', messages.length, '个候选元素');

        // 过滤和提取
        const newPromptIndex = [];

        messages.forEach((msg, index) => {
            // 验证元素
            if (!isValidUserMessage(msg, platform)) {
                return;
            }

            const text = extractMessageText(msg, platform);
            if (text) {
                // 创建定位器而不是存储元素引用
                const locator = createElementLocator(msg, platform);
                locator.index = index; // 保存索引作为后备

                newPromptIndex.push({
                    id: index,
                    text: text,
                    locator: locator,  // 存储定位器而非元素引用
                    timestamp: new Date().toLocaleTimeString()
                });
            }
        });

        console.log('[AI Prompt Index] 有效prompt数量:', newPromptIndex.length);

        // 只在有变化时更新
        if (JSON.stringify(newPromptIndex.map(p => p.text)) !== JSON.stringify(promptIndex.map(p => p.text))) {
            promptIndex = newPromptIndex;
            updateSidebar();
        }
    }

    // 查找Shadow DOM根节点
    function findShadowRoot() {
        // Gemini通常在main区域使用Shadow DOM
        const potentialHosts = [
            'main',
            '[role="main"]',
            '.main-content',
            '#main',
            'app-main'
        ];

        for (const selector of potentialHosts) {
            const elements = document.querySelectorAll(selector);
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                if (el.shadowRoot) {
                    return el.shadowRoot;
                }
            }
        }

        // 检查所有元素的shadowRoot
        const allElements = document.querySelectorAll('*');
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            if (el.shadowRoot) {
                return el.shadowRoot;
            }
        }

        return null;
    }

    // 在Shadow DOM中注入样式
    function injectStylesIntoShadow(shadowRoot) {
        if (!shadowRoot) return;

        // 检查是否已经注入过样式
        if (shadowRoot.querySelector('#ai-prompt-sidebar-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'ai-prompt-sidebar-styles';
        style.textContent = `
            #ai-prompt-sidebar {
                position: fixed !important;
                right: 0 !important;
                top: 50vh !important; /* 改为从屏幕中间开始 */
                width: ${CONFIG.collapsedWidth} !important;
                height: 50vh !important; /* 改为屏幕高度的一半 */
                background: ${CONFIG.sidebarBg} !important;
                border-left: 1px solid ${CONFIG.borderColor} !important;
                z-index: 999999 !important; /* 更高的z-index */
                overflow: visible !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                transition: width 0.25s ease-out !important;
                box-shadow: -2px 0 8px rgba(0,0,0,0.05) !important;
                cursor: move !important; /* 拖动光标 */
                user-select: none !important; /* 防止文本选中 */
            }

            #ai-prompt-sidebar.dragging {
                cursor: grabbing !important;
                transition: none !important; /* 拖动时禁用动画 */
            }

            #ai-prompt-sidebar:hover {
                width: ${CONFIG.sidebarWidth} !important;
            }

            #ai-prompt-sidebar .sidebar-content {
                opacity: 0 !important;
                visibility: hidden !important;
                transition: opacity 0.2s ease-out 0.05s, visibility 0.2s ease-out 0.05s !important;
                height: 100% !important;
                display: flex !important;
                flex-direction: column !important;
            }

            #ai-prompt-sidebar:hover .sidebar-content {
                opacity: 1 !important;
                visibility: visible !important;
            }

            /* 收起状态的圆点导航 */
            #ai-prompt-sidebar .collapsed-dots {
                position: absolute !important;
                right: 0 !important;
                top: 0 !important;
                width: ${CONFIG.collapsedWidth} !important;
                height: 100% !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                padding: 12px 0 !important;
                gap: 8px !important;
                overflow-y: auto !important;
                overflow-x: hidden !important;
                transition: opacity 0.15s ease-out !important;
            }

            #ai-prompt-sidebar:hover .collapsed-dots {
                opacity: 0 !important;
                pointer-events: none !important;
            }

            .prompt-dot {
                width: 24px !important;
                height: 24px !important;
                border-radius: 50% !important;
                background: #e0e0e0 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                color: #666 !important;
                cursor: pointer !important;
                transition: all 0.2s !important;
                flex-shrink: 0 !important;
            }

            .prompt-dot:hover {
                background: ${CONFIG.hoverColor} !important;
                transform: scale(1.1) !important;
            }

            .prompt-dot.active {
                background: ${CONFIG.activeColor} !important;
                color: white !important;
            }

            .prompt-sidebar-header {
                position: sticky !important;
                top: 0 !important;
                background: ${CONFIG.sidebarBg} !important;
                padding: 16px !important;
                border-bottom: 1px solid ${CONFIG.borderColor} !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                z-index: 10 !important;
                flex-shrink: 0 !important;
            }

            .prompt-sidebar-title {
                font-size: 14px !important;
                font-weight: 600 !important;
                color: #333 !important;
                margin: 0 !important;
            }

            .prompt-sidebar-count {
                font-size: 12px !important;
                color: #666 !important;
                background: #e0e0e0 !important;
                padding: 2px 8px !important;
                border-radius: 12px !important;
            }

            .prompt-list {
                padding: 8px 0 !important;
                flex: 1 !important;
                overflow-y: auto !important;
                overflow-x: hidden !important;
            }

            .prompt-item {
                padding: 12px 16px !important;
                cursor: pointer !important;
                border-left: 3px solid transparent !important;
                transition: all 0.2s !important;
                display: flex !important;
                align-items: center !important;
                gap: 10px !important;
            }

            .prompt-item:hover {
                background: ${CONFIG.hoverColor} !important;
            }

            .prompt-item.active {
                background: ${CONFIG.hoverColor} !important;
                border-left-color: ${CONFIG.activeColor} !important;
            }

            .prompt-number {
                min-width: 24px !important;
                height: 24px !important;
                background: #e0e0e0 !important;
                border-radius: 50% !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                color: #666 !important;
                flex-shrink: 0 !important;
            }

            .prompt-item.active .prompt-number {
                background: ${CONFIG.activeColor} !important;
                color: white !important;
            }

            .prompt-text {
                font-size: 13px !important;
                color: #333 !important;
                line-height: 1.4 !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                display: -webkit-box !important;
                -webkit-line-clamp: 2 !important;
                -webkit-box-orient: vertical !important;
                word-break: break-all !important;
            }

            .prompt-item:hover .prompt-text {
                color: ${CONFIG.activeColor} !important;
            }

            .prompt-empty {
                padding: 40px 20px !important;
                text-align: center !important;
                color: #999 !important;
                font-size: 13px !important;
            }

            .prompt-actions {
                position: sticky !important;
                bottom: 0 !important;
                background: ${CONFIG.sidebarBg} !important;
                padding: 12px 16px !important;
                border-top: 1px solid ${CONFIG.borderColor} !important;
                display: flex !important;
                gap: 8px !important;
                flex-shrink: 0 !important;
            }

            .prompt-action-btn {
                flex: 1 !important;
                padding: 8px 12px !important;
                border: 1px solid ${CONFIG.borderColor} !important;
                background: white !important;
                border-radius: 6px !important;
                font-size: 12px !important;
                cursor: pointer !important;
                transition: all 0.2s !important;
                color: #666 !important;
            }

            .prompt-action-btn:hover {
                background: ${CONFIG.hoverColor} !important;
                border-color: ${CONFIG.activeColor} !important;
                color: ${CONFIG.activeColor} !important;
            }

            /* 滚动条样式 */
            #ai-prompt-sidebar .prompt-list::-webkit-scrollbar,
            #ai-prompt-sidebar .collapsed-dots::-webkit-scrollbar {
                width: 4px !important;
            }

            #ai-prompt-sidebar .prompt-list::-webkit-scrollbar-track,
            #ai-prompt-sidebar .collapsed-dots::-webkit-scrollbar-track {
                background: transparent !important;
            }

            #ai-prompt-sidebar .prompt-list::-webkit-scrollbar-thumb,
            #ai-prompt-sidebar .collapsed-dots::-webkit-scrollbar-thumb {
                background: #ccc !important;
                border-radius: 2px !important;
            }

            #ai-prompt-sidebar .prompt-list::-webkit-scrollbar-thumb:hover,
            #ai-prompt-sidebar .collapsed-dots::-webkit-scrollbar-thumb:hover {
                background: #aaa !important;
            }
        `;
        shadowRoot.appendChild(style);
    }

    // 创建侧边栏
    function createSidebar() {
        if (sidebarElement) return;

        sidebarElement = document.createElement('div');
        sidebarElement.id = 'ai-prompt-sidebar';

        sidebarElement.innerHTML = '';
        // 使用纯 DOM 操作创建元素（避免 innerHTML 在 CSP 严格页面报错）
        // collapsed-dots
        const collapsedDots = document.createElement('div');
        collapsedDots.className = 'collapsed-dots';
        // sidebar-content
        const sidebarContent = document.createElement('div');
        sidebarContent.className = 'sidebar-content';
        // prompt-sidebar-header
        const header = document.createElement('div');
        header.className = 'prompt-sidebar-header';
        const title = document.createElement('h3');
        title.className = 'prompt-sidebar-title';
        title.textContent = '对话索引';
        const count = document.createElement('span');
        count.className = 'prompt-sidebar-count';
        count.textContent = '0';
        header.appendChild(title);
        header.appendChild(count);
        // prompt-list
        const promptList = document.createElement('div');
        promptList.className = 'prompt-list';
        const promptEmpty = document.createElement('div');
        promptEmpty.className = 'prompt-empty';
        promptEmpty.textContent = '暂无对话内容';
        promptList.appendChild(promptEmpty);
        // prompt-actions
        const actions = document.createElement('div');
        actions.className = 'prompt-actions';
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'prompt-action-btn';
        refreshBtn.id = 'prompt-refresh';
        refreshBtn.textContent = '刷新';
        const clearBtn = document.createElement('button');
        clearBtn.className = 'prompt-action-btn';
        clearBtn.id = 'prompt-clear';
        clearBtn.textContent = '清空';
        actions.appendChild(refreshBtn);
        actions.appendChild(clearBtn);
        // 组装
        sidebarContent.appendChild(header);
        sidebarContent.appendChild(promptList);
        sidebarContent.appendChild(actions);
        sidebarElement.appendChild(collapsedDots);
        sidebarElement.appendChild(sidebarContent);

        // 尝试在Shadow DOM中创建
        const shadowRoot = findShadowRoot();
        if (shadowRoot) {
            console.log('[AI Prompt Index] 在Shadow DOM中创建侧边栏');
            injectStylesIntoShadow(shadowRoot);
            shadowRoot.appendChild(sidebarElement);
            shadowRootContainer = shadowRoot; // 保存引用
        } else {
            // 回退到body
            console.log('[AI Prompt Index] 在body中创建侧边栏');
            document.body.appendChild(sidebarElement);
        }

        // 绑定事件
        bindEvents();
    }

    // 使侧边栏可拖动
    function makeSidebarDraggable(sidebar) {
        if (!sidebar) return;

        let isDragging = false;
        let startX, startY;
        let startTop;

        // 鼠标按下事件
        const onMouseDown = (e) => {
            // 防止在按钮或其他交互元素上拖动
            if (e.target.tagName === 'BUTTON' ||
                e.target.closest('button') ||
                e.target.closest('.prompt-item') ||
                e.target.closest('.prompt-dot')) {
                return;
            }

            e.preventDefault();
            isDragging = true;
            sidebar.classList.add('dragging');

            // 记录初始位置
            startX = e.clientX;
            startY = e.clientY;

            // 获取当前侧边栏的顶部位置
            const computedStyle = window.getComputedStyle(sidebar);
            startTop = parseInt(computedStyle.top);

            // 添加鼠标移动和松开事件
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            // 添加触摸事件支持
            document.addEventListener('touchmove', onTouchMove);
            document.addEventListener('touchend', onTouchEnd);
        };

        // 鼠标移动事件
        const onMouseMove = (e) => {
            if (!isDragging) return;

            e.preventDefault();

            // 计算垂直偏移量
            const deltaY = e.clientY - startY;

            // 计算新的顶部位置
            let newTop = startTop + deltaY;

            // 限制边界：不能超出屏幕
            const minTop = 0; // 最小顶部位置（贴顶）
            const maxTop = window.innerHeight - parseInt(window.getComputedStyle(sidebar).height); // 最大顶部位置（底部不超出屏幕）

            // 应用边界限制
            newTop = Math.max(minTop, Math.min(maxTop, newTop));

            // 应用新样式
            sidebar.style.top = `${newTop}px`;
        };

        // 鼠标松开事件
        const onMouseUp = () => {
            if (!isDragging) return;

            isDragging = false;
            sidebar.classList.remove('dragging');

            // 移除事件监听器
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
        };

        // 触摸移动事件
        const onTouchMove = (e) => {
            if (!isDragging || !e.touches[0]) return;

            e.preventDefault();

            const touch = e.touches[0];
            const deltaY = touch.clientY - startY;

            // 计算新的顶部位置
            let newTop = startTop + deltaY;

            // 限制边界：不能超出屏幕
            const minTop = 0;
            const maxTop = window.innerHeight - parseInt(window.getComputedStyle(sidebar).height);

            // 应用边界限制
            newTop = Math.max(minTop, Math.min(maxTop, newTop));

            // 应用新样式
            sidebar.style.top = `${newTop}px`;
        };

        // 触摸结束事件
        const onTouchEnd = () => {
            if (!isDragging) return;

            isDragging = false;
            sidebar.classList.remove('dragging');

            // 移除事件监听器
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
        };

        // 绑定鼠标和触摸事件
        sidebar.addEventListener('mousedown', onMouseDown);
        sidebar.addEventListener('touchstart', (e) => {
            if (e.target.tagName === 'BUTTON' ||
                e.target.closest('button') ||
                e.target.closest('.prompt-item') ||
                e.target.closest('.prompt-dot')) {
                return;
            }

            e.preventDefault();
            isDragging = true;
            sidebar.classList.add('dragging');

            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;

            const computedStyle = window.getComputedStyle(sidebar);
            startTop = parseInt(computedStyle.top);

            document.addEventListener('touchmove', onTouchMove);
            document.addEventListener('touchend', onTouchEnd);
        });
    }

    // 绑定事件
    function bindEvents() {
        // 确保sidebarElement存在
        if (!sidebarElement) return;

        // 刷新按钮
        const refreshBtn = sidebarElement.querySelector('#prompt-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                scanMessages();
            });
        }

        // 清空按钮
        const clearBtn = sidebarElement.querySelector('#prompt-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                promptIndex = [];
                updateSidebar();
            });
        }

        // 点击列表项跳转
        const listContainer = sidebarElement.querySelector('.prompt-list');
        if (listContainer) {
            listContainer.addEventListener('click', (e) => {
                const item = e.target.closest('.prompt-item');
                if (item) {
                    const index = parseInt(item.dataset.index);
                    scrollToPrompt(index);
                }
            });
        }

        // 点击圆点跳转
        const dotsContainer = sidebarElement.querySelector('.collapsed-dots');
        if (dotsContainer) {
            dotsContainer.addEventListener('click', (e) => {
                const dot = e.target.closest('.prompt-dot');
                if (dot) {
                    const index = parseInt(dot.dataset.index);
                    scrollToPrompt(index);
                }
            });
        }

        // 添加拖动功能
        makeSidebarDraggable(sidebarElement);
    }

    // 更新侧边栏显示（使用纯 DOM 操作避免 CSP 问题）
    function updateSidebar() {
        if (!sidebarElement) return;

        const countEl = sidebarElement.querySelector('.prompt-sidebar-count');
        const listEl = sidebarElement.querySelector('.prompt-list');
        const dotsEl = sidebarElement.querySelector('.collapsed-dots');

        countEl.textContent = promptIndex.length;

        // 清空现有内容
        while (listEl.firstChild) {
            listEl.removeChild(listEl.firstChild);
        }
        while (dotsEl.firstChild) {
            dotsEl.removeChild(dotsEl.firstChild);
        }

        // 更新展开状态的列表
        if (promptIndex.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'prompt-empty';
            emptyDiv.textContent = '暂无对话内容';
            listEl.appendChild(emptyDiv);
            return;
        }

        // 更新列表
        promptIndex.forEach((item, idx) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'prompt-item' + (idx === currentActiveIndex ? ' active' : '');
            itemDiv.dataset.index = idx;

            const numberSpan = document.createElement('span');
            numberSpan.className = 'prompt-number';
            numberSpan.textContent = idx + 1;

            const textContainer = document.createElement('div');
            textContainer.style.flex = '1';
            textContainer.style.minWidth = '0';

            const textDiv = document.createElement('div');
            textDiv.className = 'prompt-text';
            textDiv.textContent = item.text;

            textContainer.appendChild(textDiv);
            itemDiv.appendChild(numberSpan);
            itemDiv.appendChild(textContainer);
            listEl.appendChild(itemDiv);
        });

        // 更新圆点导航
        promptIndex.forEach((item, idx) => {
            const dotDiv = document.createElement('div');
            dotDiv.className = 'prompt-dot' + (idx === currentActiveIndex ? ' active' : '');
            dotDiv.dataset.index = idx;
            dotDiv.title = item.text;
            dotDiv.textContent = idx + 1;
            dotsEl.appendChild(dotDiv);
        });
    }

    // HTML转义
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

// 多策略滚动到元素（调试版本）
  function tryScrollToElement(element, locator, platform) {
      if (!element) {
          console.log('[AI Prompt Index] tryScrollToElement: 元素为空');
          return false;
      }

      const rect = element.getBoundingClientRect();
      console.log('[AI Prompt Index] tryScrollToElement: 元素位置信息:', {
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          viewportHeight: window.innerHeight
      });

      // Kimi 平台特殊处理：优先使用容器滚动（策略 3）
      if (platform === 'kimi') {
          console.log('[AI Prompt Index] tryScrollToElement: Kimi 平台优先尝试容器滚动');
          let scrollContainer = element.parentElement;
          while (scrollContainer) {
              const style = window.getComputedStyle(scrollContainer);
              if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                  style.overflow === 'auto' || style.overflow === 'scroll') {
                  console.log('[AI Prompt Index] tryScrollToElement: 找到滚动容器:', scrollContainer.tagName, 'class:', scrollContainer.className);
                  const containerRect = scrollContainer.getBoundingClientRect();
                  const scrollTop = scrollContainer.scrollTop;

                  // 计算元素在容器内的实际位置（相对于容器内容，而不是视口）
                  // 元素在容器内容中的绝对位置 = 元素相对于容器视口的位置 + 容器已滚动的距离
                  const elementOffsetInContainer = (rect.top - containerRect.top) + scrollTop;

                  // 目标滚动位置：让元素位于容器中间
                  let targetScrollTop = elementOffsetInContainer - scrollContainer.clientHeight / 2;

                  // 边界检查：确保 targetScrollTop 在有效范围内（不能为负，也不能超过最大值）
                  const minScrollTop = 0;
                  const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
                  targetScrollTop = Math.max(minScrollTop, Math.min(maxScrollTop, targetScrollTop));

                  console.log('[AI Prompt Index] tryScrollToElement: 容器滚动计算:', {
                      elementTop: rect.top,
                      containerTop: containerRect.top,
                      elementInContainer: elementOffsetInContainer,
                      rawTargetScrollTop: elementOffsetInContainer - scrollContainer.clientHeight / 2,
                      targetScrollTop: targetScrollTop,
                      currentScrollTop: scrollTop,
                      containerHeight: scrollContainer.clientHeight,
                      containerScrollHeight: scrollContainer.scrollHeight,
                      maxScrollTop: maxScrollTop
                  });

                  scrollContainer.scrollTo({
                      top: targetScrollTop,
                      behavior: 'auto' // Kimi 页面使用 auto，避免 smooth 导致的滚动位置计算错误
                  });
                  console.log('[AI Prompt Index] tryScrollToElement: 容器滚动执行成功，滚动后 scrollTop:', scrollContainer.scrollTop);
                  return true;
              }
              scrollContainer = scrollContainer.parentElement;
          }
          console.log('[AI Prompt Index] tryScrollToElement: Kimi 容器滚动未找到合适容器，尝试其他策略');
      }

      try {
          // 策略 1: 标准 scrollIntoView
          console.log('[AI Prompt Index] tryScrollToElement: 尝试策略 1 - scrollIntoView');
          element.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
          });
          console.log('[AI Prompt Index] tryScrollToElement: 策略 1 执行成功');
          return true;
      } catch (e) {
          console.warn('[AI Prompt Index] scrollIntoView 失败:', e);
      }

      try {
          // 策略 2: 手动计算位置滚动
          console.log('[AI Prompt Index] tryScrollToElement: 尝试策略 2 -  手动滚动 window');
          const scrollTop = window.pageYOffset ||
  document.documentElement.scrollTop;
          const targetTop = rect.top + scrollTop - window.innerHeight / 2;
          console.log('[AI Prompt Index] tryScrollToElement: 目标滚动位置:',
  targetTop, '当前 scrollTop:', scrollTop);

          window.scrollTo({
              top: targetTop,
              behavior: 'smooth'
          });
          console.log('[AI Prompt Index] tryScrollToElement: 策略 2 执行成功');
          return true;
      } catch (e) {
          console.warn('[AI Prompt Index] 手动滚动失败:', e);
      }

      try {
          // 策略 3: 查找滚动容器并滚动
          console.log('[AI Prompt Index] tryScrollToElement: 尝试策略 3 -  查找滚动容器');
          let scrollContainer = element.parentElement;
          while (scrollContainer) {
              const style = window.getComputedStyle(scrollContainer);
              if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                  style.overflow === 'auto' || style.overflow === 'scroll') {
                  console.log('[AI Prompt Index] tryScrollToElement:  找到滚动容器:', scrollContainer.tagName);
                  const containerRect = scrollContainer.getBoundingClientRect();
                  const scrollTop = scrollContainer.scrollTop;
                  const targetTop = rect.top - containerRect.top + scrollTop -  scrollContainer.clientHeight / 2;
                  console.log('[AI Prompt Index] tryScrollToElement:  容器滚动目标位置:', targetTop, '容器 scrollTop:', scrollTop);

                  scrollContainer.scrollTo({
                      top: targetTop,
                      behavior: 'smooth'
                  });
                  console.log('[AI Prompt Index] tryScrollToElement: 策略 3  执行成功');
                  return true;
              }
              scrollContainer = scrollContainer.parentElement;
          }
      } catch (e) {
          console.warn('[AI Prompt Index] 容器滚动失败:', e);
      }

      console.log('[AI Prompt Index] tryScrollToElement: 所有策略均失败');
      return false;
  }

    // 滚动到指定prompt
    function scrollToPrompt(index) {
        if (index < 0 || index >= promptIndex.length) return;

        const item = promptIndex[index];
        if (!item) return;

        console.log('[AI Prompt Index] === 开始跳转到索引:', index, '===');
        console.log('[AI Prompt Index] 存储的 locator:', JSON.stringify(item.locator, null, 2));

        // 更新激活状态
        currentActiveIndex = index;
        updateSidebar();

        // 如果有定位器，先尝试重新查找元素
        let element = null;
        if (item.locator) {
            element = findElementByLocator(item.locator, item.locator.platform);
        }

        console.log('[AI Prompt Index] 查找到的元素:', element);
        if (element) {
            console.log('[AI Prompt Index] 元素文本:', (element.textContent || '').substring(0, 50));
            console.log('[AI Prompt Index] 元素选择器路径:', getElementPath(element));
        }

        // 如果找不到元素，直接返回
        if (!element) {
            console.warn('[AI Prompt Index] 无法找到索引元素:', index);
            // 调试：打印当前页面所有匹配的元素
            const selector = getUserMessageSelector('kimi');
            const allElements = document.querySelectorAll(selector);
            console.log('[AI Prompt Index] 页面中所有匹配选择器"', selector, '"的元素数量:', allElements.length);
            allElements.forEach((el, i) => {
                console.log('[AI Prompt Index] 元素' + i + ':', (el.textContent || '').substring(0, 30), 'dataset:', el.dataset);
            });
            return;
        }

        // 尝试多种滚动策略
        const scrolled = tryScrollToElement(element, item.locator, item.locator.platform);

        if (scrolled) {
            // 高亮效果
            highlightElement(element);
        } else {
            console.warn('[AI Prompt Index] 所有滚动策略均失败');
        }
    }

    // 获取元素的 CSS 路径（用于调试）
    function getElementPath(element) {
        if (!element) return 'null';
        const path = [];
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            let selector = current.nodeName.toLowerCase();
            if (current.id) {
                selector += '#' + current.id;
                path.unshift(selector);
                break;
            } else {
                let sibling = current;
                let nth = 1;
                while (sibling.previousElementSibling) {
                    sibling = sibling.previousElementSibling;
                    if (sibling.nodeName === current.nodeName) nth++;
                }
                if (nth > 1) selector += ':nth-of-type(' + nth + ')';
            }
            path.unshift(selector);
            current = current.parentNode;
        }
        return path.join(' > ');
    }

    // 高亮元素
    function highlightElement(element) {
        const originalTransition = element.style.transition;
        const originalBoxShadow = element.style.boxShadow;
        const originalOutline = element.style.outline;

        element.style.transition = 'box-shadow 0.3s ease, outline 0.3s ease';
        element.style.boxShadow = '0 0 0 3px rgba(74, 144, 217, 0.5)';
        element.style.outline = 'none';

        setTimeout(() => {
            element.style.boxShadow = originalBoxShadow;
            element.style.outline = originalOutline;
            element.style.transition = originalTransition;
        }, 2000);
    }

    // 监听滚动，自动更新当前激活项
    function handleScroll() {
        if (promptIndex.length === 0) return;

        const viewportCenter = window.innerHeight / 2;
        let closestIndex = -1;
        let closestDistance = Infinity;

        promptIndex.forEach((item, index) => {
            // 使用定位器重新查找元素
            let element = null;
            if (item.locator) {
                element = findElementByLocator(item.locator, item.locator.platform);
            }

            if (element) {
                const rect = element.getBoundingClientRect();
                const distance = Math.abs(rect.top - viewportCenter);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestIndex = index;
                }
            }
        });

        if (closestIndex !== currentActiveIndex && closestIndex !== -1) {
            currentActiveIndex = closestIndex;
            updateSidebar();
        }
    }

    // 使用MutationObserver监听DOM变化
    function observeChanges() {
        const observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;

            mutations.forEach(mutation => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const platform = detectPlatform();
                            const selector = getUserMessageSelector(platform);

                            if (!selector) return;

                            try {
                                if (node.matches && node.matches(selector)) {
                                    shouldUpdate = true;
                                }
                                if (node.querySelector && node.querySelector(selector)) {
                                    shouldUpdate = true;
                                }
                            } catch (e) {
                                // 忽略无效选择器
                            }
                        }
                    });
                }
            });

            if (shouldUpdate) {
                clearTimeout(window.updateTimeout);
                window.updateTimeout = setTimeout(scanMessages, 500);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // 初始化
    async function init() {
        console.log('[AI Prompt Index] 初始化中...');

        // 等待页面加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }

        // 创建侧边栏
        createSidebar();

        // 千问页面：先加载所有历史消息
        const platform = detectPlatform();
        if (platform === 'qianwen') {
            await loadAllMessages(platform);
        }

        // 初始扫描（延迟以确保页面完全加载）
        setTimeout(scanMessages, 2000);

        // 监听DOM变化
        observeChanges();

        // 监听滚动
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(handleScroll, 100);
        }, { passive: true });

        // 定期刷新
        setInterval(scanMessages, 5000);

        console.log('[AI Prompt Index] 初始化完成');
    }
    
    // 启动
    init();
})();
