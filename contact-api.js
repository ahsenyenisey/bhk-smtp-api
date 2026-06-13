require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const multer = require('multer');
const MAX_TOTAL_SIZE = 18 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_TOTAL_SIZE, files: 5 } });

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://badheizkoerper.shop').split(',');
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const MAIL_TO = process.env.MAIL_TO || 'support@badheizkoerper.shop';
const MAIL_FROM = process.env.MAIL_FROM || 'support@badheizkoerper.shop';

app.use(cors({
  origin: function (origin, cb) {
    if (!origin || ALLOWED_ORIGINS.indexOf(origin) !== -1) return cb(null, true);
    cb(new Error('CORS not allowed'));
  },
  methods: ['POST', 'GET']
}));

app.use(express.json({ limit: '1mb' }));

var submitLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyGenerator: function (req) { return req.ip; },
  message: { error: 'Zu viele Anfragen. Bitte versuchen Sie es in einigen Minuten erneut.' }
});

var captchaStore = new Map();

setInterval(function () {
  var now = Date.now();
  captchaStore.forEach(function (val, key) {
    if (val.expires < now) captchaStore.delete(key);
  });
}, 60000);

app.get('/api/captcha', function (req, res) {
  var a = 2 + Math.floor(Math.random() * 8);
  var b = 2 + Math.floor(Math.random() * 8);
  var id = crypto.randomBytes(16).toString('hex');
  captchaStore.set(id, { sum: a + b, expires: Date.now() + 5 * 60 * 1000 });
  res.json({ id: id, question: a + ' + ' + b + ' = ?' });
});

app.post('/api/contact', submitLimiter, upload.array('files', 5), async function (req, res) {
  try {
    var d = req.body;
    if (typeof d === 'string') d = JSON.parse(d);

    if (!d.captchaId || !d.captchaAnswer) {
      return res.status(400).json({ error: 'Captcha fehlt.' });
    }
    var cap = captchaStore.get(d.captchaId);
    if (!cap) {
      return res.status(400).json({ error: 'Captcha abgelaufen. Bitte Seite neu laden.' });
    }
    if (parseInt(d.captchaAnswer) !== cap.sum) {
      captchaStore.delete(d.captchaId);
      return res.status(400).json({ error: 'Captcha falsch.', newCaptcha: true });
    }
    captchaStore.delete(d.captchaId);

    if (req.files && req.files.length > 0) {
      var totalSize = req.files.reduce(function(sum, f) { return sum + f.size; }, 0);
      if (totalSize > MAX_TOTAL_SIZE) {
        return res.status(400).json({ error: 'Dateien zu groß. Maximale Gesamtgröße: 18 MB.' });
      }
    }

    if (!d.vorname || !d.nachname || !d.email || !d.anliegen || !d.nachricht) {
      return res.status(400).json({ error: 'Pflichtfelder fehlen.' });
    }

    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(d.email)) {
      return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
    }

    function sanitize(s){return String(s||'').replace(/[\r\n]/g,' ').trim();}
    d.vorname=sanitize(d.vorname);d.nachname=sanitize(d.nachname);d.email=sanitize(d.email);
    d.anliegen=sanitize(d.anliegen);d.nachricht=String(d.nachricht||'').trim();
    if(d.telefon)d.telefon=sanitize(d.telefon);
    if(d.bestellnummer)d.bestellnummer=sanitize(d.bestellnummer);
    if(d.firmenname)d.firmenname=sanitize(d.firmenname);
    if(d.ustid)d.ustid=sanitize(d.ustid);
    if(d.lieferanschrift)d.lieferanschrift=String(d.lieferanschrift||'').trim();
    if(d.rechnungsanschrift)d.rechnungsanschrift=String(d.rechnungsanschrift||'').trim();
    var name = d.nachname + ', ' + d.vorname;
    var subjectParts = [];
    if (d.bestellnummer) subjectParts.push(d.bestellnummer);
    subjectParts.push(name);
    subjectParts.push(d.anliegen);
    var subjectLine = subjectParts.join(' | ');

    function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
    var rows = [];
    rows.push(['Anliegen', d.anliegen]);
    if (d.bestellnummer) rows.push(['Bestellnummer', d.bestellnummer]);
    rows.push(['Name', name]);
    rows.push(['E-Mail', d.email]);
    if (d.telefon) rows.push(['Telefon', d.telefon]);
    if (d.firmenname) rows.push(['Firmenname', d.firmenname]);
    if (d.land) rows.push(['Land', d.land]);
    if (d.ustid) rows.push(['USt-ID', d.ustid]);
    if (d.reverseCharge) rows.push(['Reverse-Charge', 'Ja']);
    if (d.lieferanschrift) rows.push(['Lieferanschrift', d.lieferanschrift]);
    if (d.rechnungsanschrift) rows.push(['Rechnungsanschrift', d.rechnungsanschrift]);
    if (d.warenankunft) rows.push(['Warenankunft', d.warenankunft]);
    rows.push(['Nachricht', d.nachricht]);
    rows.push(['Datenschutz-Zustimmung', 'Ja']);
    var tableRows = rows.map(function(r){return '<tr><td style="padding:8px 12px;font-weight:600;color:#555;white-space:nowrap;border-bottom:1px solid #eee;vertical-align:top">'+esc(r[0])+'</td><td style="padding:8px 12px;border-bottom:1px solid #eee;white-space:pre-line">'+esc(r[1])+'</td></tr>';}).join('');
    var htmlBody = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#1A1A1A;border-bottom:2px solid #991E21;padding-bottom:8px">'+esc(subjectLine)+'</h2><table style="width:100%;border-collapse:collapse;font-size:14px">'+tableRows+'</table><p style="margin-top:20px;font-size:11px;color:#999">Gesendet über badheizkoerper.shop Kontaktformular</p></div>';
    var vyntag = '<!-- #VYN-4JfgUiopphj1BbdVj1GlAy3P6VKwWgUZ -->';
    htmlBody += '<div style="font-size:0;line-height:0;color:transparent;overflow:hidden;max-height:0">' + esc(vyntag) + '</div>';
    var textBody = rows.map(function(r){return r[0]+': '+r[1];}).join('\n') + '\n\n' + vyntag;

    var brevoPayload = {
      sender: { name: name, email: MAIL_FROM },
      to: [{ email: MAIL_TO, name: 'Badheizkoerper Support' }],
      replyTo: { email: d.email, name: name },
      subject: subjectLine,
      htmlContent: htmlBody,
      textContent: textBody,
      headers: {
        'X-Contact-Name': name,
        'X-Contact-Email': d.email,
        'X-Contact-Topic': d.anliegen,
        'X-Contact-Subject': subjectLine
      }
    };
    if (d.telefon) brevoPayload.headers['X-Contact-Phone'] = d.telefon;
    if (d.bestellnummer) brevoPayload.headers['X-Contact-Order'] = d.bestellnummer;
    if (req.files && req.files.length > 0) {
      brevoPayload.attachment = req.files.map(function(f) {
        return { content: f.buffer.toString('base64'), name: f.originalname };
      });
    }

    var response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify(brevoPayload)
    });

    var result = await response.json();

    if (response.ok) {
      res.json({ success: true, message: 'Ihre Anfrage wurde erfolgreich gesendet.' });
    } else {
      console.error('Brevo error:', result);
      res.status(500).json({ error: 'Fehler beim Senden. Bitte versuchen Sie es später erneut.' });
    }

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Fehler beim Senden. Bitte versuchen Sie es später erneut.' });
  }
});

app.get('/health', function (req, res) {
  res.json({ status: 'ok' });
});

app.get('/whoami', function (req, res) {
  res.json({
    service: 'bhk-smtp-api',
    pid: process.pid,
    uptime: process.uptime(),
    port: PORT,
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, function () {
  console.log('Contact API running on port ' + PORT);
});
