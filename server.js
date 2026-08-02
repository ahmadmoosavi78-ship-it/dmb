const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.DMB_MODEL || 'gemini-2.0-flash';
const MEMORY_FILE = path.join(__dirname, 'data', 'memory.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataDir() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ facts: [], history: [] }, null, 2));
  }
}
function loadMemory() {
  ensureDataDir();
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); }
  catch { return { facts: [], history: [] }; }
}
function saveMemory(mem) {
  ensureDataDir();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
}

const BASE_SYSTEM_PROMPT = `تو "dmb" هستی، دستیار شخصی هوشمند احمد موسوی، صاحب موبایل آرمان در ساری.
همیشه به فارسی و خودمونی و مفید جواب بده، مگر اینکه ازت به زبان دیگه‌ای بپرسه.
کارهایی که احمد ازت می‌خواد رو دقیق و بدون حاشیه‌ی زیاد انجام بده.
اگه چیزی رو مطمئن نیستی، صادقانه بگو مطمئن نیستی به‌جای حدس زدن.`;

app.post('/api/chat', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY تنظیم نشده روی سرور.' });
  }
  const userMessage = (req.body.message || '').trim();
  if (!userMessage) return res.status(400).json({ error: 'پیام خالیه.' });

  const mem = loadMemory();
  const factsBlock = mem.facts.length
    ? `\n\nچیزهایی که قبلاً درباره‌ی احمد یاد گرفتی:\n- ${mem.facts.join('\n- ')}`
    : '';

  const historyContents = mem.history.slice(-20).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const contents = [...historyContents, { role: 'user', parts: [{ text: userMessage }] }];

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: BASE_SYSTEM_PROMPT + factsBlock }] },
        contents
      })
    });

    const data = await response.json();
    if (data.error) {
      return res.status(500).json({ error: data.error.message || 'خطا از سمت Gemini API' });
    }

    const reply = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || 'جوابی برنگشت.';

    mem.history.push({ role: 'user', content: userMessage });
    mem.history.push({ role: 'assistant', content: reply });
    if (mem.history.length > 60) mem.history = mem.history.slice(-60);
    saveMemory(mem);

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ارتباط با Gemini برقرار نشد.' });
  }
});

app.post('/api/remember', (req, res) => {
  const fact = (req.body.fact || '').trim();
  if (!fact) return res.status(400).json({ error: 'fact خالیه.' });
  const mem = loadMemory();
  mem.facts.push(fact);
  saveMemory(mem);
  res.json({ ok: true, facts: mem.facts });
});

app.listen(PORT, () => {
  console.log(`dmb روی پورت ${PORT} روشنه`);
});
