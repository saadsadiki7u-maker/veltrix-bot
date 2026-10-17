const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const qrcode = require('qrcode-terminal');

const DATA_FILE = './bot_data.json';

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        } catch (e) {
            return { warnings: {}, muted: {}, points: {}, linkProtection: {} };
        }
    }
    return { warnings: {}, muted: {}, points: {}, linkProtection: {} };
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📌 يرجى مسح رمز الـ QR التالي بواسطة تطبيق واتساب:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('الاتصال تقطع، جاري إعادة المحاولة...', shouldReconnect);
            if (shouldReconnect) { startBot(); }
        } else if (connection === 'open') {
            console.log('🎉 مبروك! بوت VELTRIX متصل بواتساب بنجاح وكافة نظم الحماية مفعلة.');
        }
    });

    // ترحيب الأعضاء الجدد
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            const chatId = anu.id;
            const participants = anu.participants;
            if (anu.action === 'add') {
                for (let num of participants) {
                    await delay(1500);
                    const userJid = typeof num === 'string' ? num : (num.id || '');
                    const phoneNumber = userJid.split('@')[0];
                    if (phoneNumber) {
                        await sock.sendMessage(chatId, {
                            text: `✨ أهلاً بك يا @${phoneNumber} في عائلة **VELTRIX**!\n⚜️ نرجو منك الالتزام بقوانين المجموعة.\n📌 اكتب \`.menu\` لعرض القائمة.`,
                            mentions: [userJid]
                        });
                    }
                }
            }
        } catch (err) {
            console.log('خطأ في الترحيب:', err);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const mek = m.messages[0];
            if (!mek.message) return;
            if (mek.key.fromMe) return;

            const chatId = mek.key.remoteJid; 
            const isGroup = chatId && chatId.endsWith('@g.us');
            if (!isGroup) return; 

            const sender = mek.key.participant || mek.key.remoteJid;
            if (!sender) return;

            // تحميل وتهيئة البيانات بأمان
            let data = loadData();
            if (!data.warnings) data.warnings = {};
            if (!data.muted) data.muted = {};
            if (!data.points) data.points = {};
            if (!data.linkProtection) data.linkProtection = {};

            if (!data.warnings[chatId]) data.warnings[chatId] = {};
            if (!Array.isArray(data.muted[chatId])) data.muted[chatId] = [];
            if (!data.points[chatId]) data.points[chatId] = {};
            if (data.linkProtection[chatId] === undefined) data.linkProtection[chatId] = true;

            // استخراج النص بذكاء ودقة تامة (يشمل الرسائل المؤقتة والمغلفة)
            let msgContent = mek.message;
            if (msgContent.ephemeralMessage) {
                msgContent = msgContent.ephemeralMessage.message;
            }
            if (msgContent.viewOnceMessage) {
                msgContent = msgContent.viewOnceMessage.message;
            }

            const messageText = 
                msgContent.conversation ||
                msgContent.extendedTextMessage?.text ||
                msgContent.imageMessage?.caption ||
                msgContent.videoMessage?.caption || '';

            const cleanText = messageText ? messageText.trim() : '';

            // 1. الكتم التلقائي
            if (data.muted[chatId].includes(sender)) {
                await sock.sendMessage(chatId, { 
                    delete: { remoteJid: chatId, fromMe: false, id: mek.key.id, participant: sender } 
                });
                return;
            }

            // 2. أمر القائمة (.menu)
            if (cleanText === '.menu' || cleanText === '.قائمة' || cleanText === 'menu' || cleanText === 'قائمة') {
                const menuText = 
`╭━━━〔 🌟 **VELTRIX BOT** 🌟 〕━━━╮
┃
┃  👋 أهلاً بك في قائمة الأوامر الشاملة
┃
┃  🔒 **أوامر الإدارة الأساسية:**
┃  🔹 .قفل - إغلاق المجموعة
┃  🔹 .فتح - فتح المجموعة
┃  🔹 .كتم \`@منشن\` أو بالرد - كتم عضو
┃  🔹 .فك \`@منشن\` أو بالرد - فك الكتم
┃  🔹 .حذف - حذف رسالة (بالرد عليها)
┃  🔹 .رفع \`@منشن\` - ترقية لأدمن
┃  🔹 .خفض \`@منشن\` - تنزيل من الأدمن
┃
┃  ⚠️ **أوامر التحذيرات والتفاعل:**
┃  🔹 .حذر \`@منشن\` - إنذار (طرد عند 5)
┃  🔹 .عفو \`@منشن\` - مسح الإنذارات
┃  🔹 .عدد \`@منشن\` - عرض عدد الإنذارات
┃  🔹 .حسبه - إحصائيات التفاعل
┃  🔹 .مانع - تفعيل/تعطيل الروابط
┃  🔹 .سجل - حالة الحماية
┃
╰━━━━━━━━━━━━━━━━━━━╯`;
                await sock.sendMessage(chatId, { text: menuText });
                return;
            }

            // 3. أمر القوانين
            if (cleanText === '.قوانين' || cleanText === 'قوانين') {
                const rulesText = `⚠️ **قوانين المجموعة:** يرجى الالتزام وعدم نشر الروابط أو السب لكي لا تتعرض للطرد تلقائياً.`;
                await sock.sendMessage(chatId, { text: rulesText });
                return;
            }

            // 4. معالجة الأوامر الإدارية بأمان تام
            if (cleanText.startsWith('.')) {
                const args = cleanText.slice(1).split(' ');
                const command = args[0].toLowerCase();

                const adminCommands = ['قفل', 'فتح', 'كتم', 'فك', 'حذف', 'رفع', 'خفض', 'حذر', 'عفو', 'عدد', 'حسبه', 'يوم', 'وسام', 'مانع', 'سجل'];
                
                if (adminCommands.includes(command)) {
                    const groupMetadata = await sock.groupMetadata(chatId);
                    const participants = groupMetadata.participants || [];
                    const groupAdmins = participants.filter(p => p.admin !== null).map(p => p.id);
                    const isSenderAdmin = groupAdmins.includes(sender);

                    if (!isSenderAdmin) {
                        await sock.sendMessage(chatId, { text: `❌ عذراً @${sender.split('@')[0]}، هذه الأوامر مخصصة للمشرفين فقط!`, mentions: [sender] });
                        return;
                    }

                    let targetUser = null;
                    const contextInfo = msgContent.extendedTextMessage?.contextInfo;
                    const mentions = contextInfo?.mentionedJid || [];
                    
                    if (mentions.length > 0) {
                        targetUser = mentions[0];
                    } else if (contextInfo && contextInfo.participant) {
                        targetUser = contextInfo.participant;
                    }

                    switch (command) {
                        case 'قفل':
                            await sock.groupSettingUpdate(chatId, 'announcement');
                            await sock.sendMessage(chatId, { text: `🔒 تم إغلاق المجموعة بنجاح.` });
                            break;

                        case 'فتح':
                            await sock.groupSettingUpdate(chatId, 'not_announcement');
                            await sock.sendMessage(chatId, { text: `🔓 تم فتح المجموعة للجميع.` });
                            break;

                        case 'كتم':
                            if (!targetUser) {
                                await sock.sendMessage(chatId, { text: `⚠️ يرجى منشن العضو أو الرد على رسالته لكتمه!` });
                                return;
                            }
                            if (!data.muted[chatId].includes(targetUser)) {
                                data.muted[chatId].push(targetUser);
                                saveData(data);
                            }
                            await sock.sendMessage(chatId, { text: `🔇 تم كتم العضو @${targetUser.split('@')[0]} بنجاح.`, mentions: [targetUser] });
                            break;

                        case 'فك':
                            if (!targetUser) {
                                await sock.sendMessage(chatId, { text: `⚠️ يرجى منشن العضو أو الرد على رسالته لفك الكتم!` });
                                return;
                            }
                            data.muted[chatId] = data.muted[chatId].filter(id => id !== targetUser);
                            saveData(data);
                            await sock.sendMessage(chatId, { text: `🔊 تم رفع الكتم عن العضو @${targetUser.split('@')[0]}.`, mentions: [targetUser] });
                            break;

                        case 'حذف':
                            if (contextInfo && contextInfo.stanzaId) {
                                await sock.sendMessage(chatId, { 
                                    delete: { remoteJid: chatId, fromMe: false, id: contextInfo.stanzaId, participant: contextInfo.participant } 
                                });
                            } else {
                                await sock.sendMessage(chatId, { text: `⚠️ يرجى الرد على الرسالة المراد حذفها واستخدام الأمر .حذف` });
                            }
                            break;

                        case 'رفع':
                            if (!targetUser) {
                                await sock.sendMessage(chatId, { text: `⚠️ يرجى منشن العضو لترقيته لأدمن!` });
                                return;
                            }
                            await sock.groupParticipantsUpdate(chatId, [targetUser], "promote");
                            await sock.sendMessage(chatId, { text: `⭐ تم ترقية العضو @${targetUser.split('@')[0]} إلى مشرف.`, mentions: [targetUser] });
                            break;

                        case 'خفض':
                            if (!targetUser) {
                                await sock.sendMessage(chatId, { text: `⚠️ يرجى منشن المشرف لتنزيله!` });
                                return;
                            }
                            await sock.groupParticipantsUpdate(chatId, [targetUser], "demote");
                            await sock.sendMessage(chatId, { text: `🔻 تم سحب الإشراف عن العضو @${targetUser.split('@')[0]}.`, mentions: [targetUser] });
                            break;

                        case 'حذر':
                            if (!targetUser) {
                                await sock.sendMessage(chatId, { text: `⚠️ يرجى منشن العضو لإعطائه إنذاراً!` });
                                return;
                            }
                            if (!data.warnings[chatId][targetUser]) data.warnings[chatId][targetUser] = 0;
                            data.warnings[chatId][targetUser] += 1;
                            let warns = data.warnings[chatId][targetUser];
                            saveData(data);

                            if (warns < 5) {
                                await sock.sendMessage(chatId, { text: `⚠️ تم إنذار العضو @${targetUser.split('@')[0]} (${warns}/5).`, mentions: [targetUser] });
                            } else {
                                await sock.sendMessage(chatId, { text: `🚫 العضو @${targetUser.split('@')[0]} وصل إلى 5 إنذارات وسيتم طرده الآن!`, mentions: [targetUser] });
                                await delay(1000);
                                await sock.groupParticipantsUpdate(chatId, [targetUser], "remove");
                                data.warnings[chatId][targetUser] = 0;
                                saveData(data);
                            }
                            break;

                        case 'عفو':
                            if (!targetUser) {
                                await sock.sendMessage(chatId, { text: `⚠️ يرجى منشن العضو لمسح إنذاراته!` });
                                return;
                            }
                            data.warnings[chatId][targetUser] = 0;
                            saveData(data);
                            await sock.sendMessage(chatId, { text: `✅ تم مسح جميع الإنذارات عن العضو @${targetUser.split('@')[0]}.`, mentions: [targetUser] });
                            break;

                        case 'عدد':
                            if (!targetUser) {
                                await sock.sendMessage(chatId, { text: `⚠️ يرجى منشن العضو لمعرفة عدد إنذاراته!` });
                                return;
                            }
                            let count = data.warnings[chatId][targetUser] || 0;
                            await sock.sendMessage(chatId, { text: `📊 عدد إنذارات العضو @${targetUser.split('@')[0]} هو: ${count}/5`, mentions: [targetUser] });
                            break;

                        case 'حسبه':
                            let totalActive = Object.keys(data.points[chatId] || {}).length;
                            await sock.sendMessage(chatId, { text: `📊 إجمالي عدد المتفاعلين النشطين في الجروب هو ${totalActive} عضو.` });
                            break;

                        case 'يوم':
                            await sock.sendMessage(chatId, { text: `📅 النظام يسجل تفاعلات الأعضاء بشكل مستمر.` });
                            break;

                        case 'وسام':
                            await sock.sendMessage(chatId, { text: `🏆 يتم منح الميداليات تلقائياً للأعضاء الأكثر تفاعلاً.` });
                            break;

                        case 'مانع':
                            data.linkProtection[chatId] = !data.linkProtection[chatId];
                            saveData(data);
                            await sock.sendMessage(chatId, { text: `🛡️ مانع الروابط أصبح الآن: ${data.linkProtection[chatId] ? 'مفعل ✅' : 'متوقف ❌'}` });
                            break;

                        case 'سجل':
                            await sock.sendMessage(chatId, { text: `📋 مانع الروابط والسبام يعمل بكفاءة تامة.` });
                            break;
                    }
                    return;
                }
            }

            // 5. نظام النقاط
            if (!data.points[chatId][sender]) {
                data.points[chatId][sender] = 0;
            }
            data.points[chatId][sender] += 1;
            saveData(data);

            // 6. الحماية التلقائية
            if (data.linkProtection[chatId]) {
                const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)/gi;
                const badWords = ['كس', 'زك', 'قحاب', 'قحبة', 'زب', 'منيوك', 'لواط', 'سحاق']; 
                
                let hasViolation = false;
                let violationReason = '';

                if (cleanText && linkRegex.test(cleanText)) {
                    hasViolation = true;
                    violationReason = 'نشر الروابط ممنوع!';
                } else if (cleanText) {
                    const lowerText = cleanText.toLowerCase();
                    for (let word of badWords) {
                        if (lowerText.includes(word)) {
                            hasViolation = true;
                            violationReason = 'السب والشتم ممنوع!';
                            break;
                        }
                    }
                }

                if (hasViolation) {
                    await sock.sendMessage(chatId, { 
                        delete: { remoteJid: chatId, fromMe: false, id: mek.key.id, participant: sender } 
                    });

                    if (!data.warnings[chatId][sender]) data.warnings[chatId][sender] = 0;
                    data.warnings[chatId][sender] += 1;
                    let currentWarnings = data.warnings[chatId][sender];
                    saveData(data);

                    if (currentWarnings < 5) {
                        await sock.sendMessage(chatId, { 
                            text: `⚠️ تنبيه @${sender.split('@')[0]} (${currentWarnings}/5): ${violationReason}`,
                            mentions: [sender] 
                        });
                    } else {
                        await sock.sendMessage(chatId, { 
                            text: `🚫 العضو @${sender.split('@')[0]} وصل لـ 5 إنذارات وسيتم طرده!`,
                            mentions: [sender] 
                        });
                        await delay(1000);
                        await sock.groupParticipantsUpdate(chatId, [sender], "remove");
                        data.warnings[chatId][sender] = 0;
                        saveData(data);
                    }
                }
            }

        } catch (error) {
            console.log('خطأ في معالجة الرسالة:', error);
        }
    });
}

startBot();