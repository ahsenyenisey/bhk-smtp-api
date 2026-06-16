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

var ALLOWED_ORIGINS = ['https://badheizkoerper.shop','https://www.badheizkoerper.shop','https://premium-heizungen.myshopify.com'];
if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').forEach(function(o){ if(ALLOWED_ORIGINS.indexOf(o)===-1) ALLOWED_ORIGINS.push(o); });
}
const VYNFORM_API = 'https://svc-vynform-api.dockup.tech';
const VYNFORM_ID = 'h6nmt71nqa';
const VF = {
  vorname: '9ec268a9-0604-462d-876d-954fd33df210',
  nachname: '7ecf43a4-1d9d-4cf0-a6f8-40e38bbd0ce0',
  email: '1dfcecfa-7bb6-4e2e-8175-87eff7c1b1f0',
  telefon: '1257f979-3a18-4e2b-ab43-2ba313bb9c1c',
  anliegen: '042805d1-0536-4cdf-9fa2-c5113f6c7f9d',
  nachricht: 'ff64d5d0-a10a-422e-be69-7a0a95cfe060'
};

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

    var msgParts = [];
    if (d.bestellnummer) msgParts.push('Bestellnummer: ' + d.bestellnummer);
    if (d.firmenname) msgParts.push('Firmenname: ' + d.firmenname);
    if (d.land) msgParts.push('Land: ' + d.land);
    if (d.ustid) msgParts.push('USt-ID: ' + d.ustid);
    if (d.reverseCharge) msgParts.push('Reverse-Charge: Ja');
    if (d.lieferanschrift) msgParts.push('Lieferanschrift: ' + d.lieferanschrift);
    if (d.rechnungsanschrift) msgParts.push('Rechnungsanschrift: ' + d.rechnungsanschrift);
    if (d.warenankunft) msgParts.push('Warenankunft: ' + d.warenankunft);
    msgParts.push(d.nachricht);
    var vynMsg = msgParts.join('\n');

    var vynData = {};
    vynData[VF.vorname] = d.vorname;
    vynData[VF.nachname] = d.nachname;
    vynData[VF.email] = d.email;
    vynData[VF.telefon] = d.telefon || '';
    vynData[VF.anliegen] = d.anliegen;
    vynData[VF.nachricht] = vynMsg;

    var vynRes = await fetch(VYNFORM_API + '/api/public/form/' + VYNFORM_ID + '/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: vynData })
    });
    var vynResult = await vynRes.json();

    if (vynRes.ok && vynResult.success) {
      res.json({ success: true, message: 'Ihre Anfrage wurde erfolgreich gesendet.' });
    } else {
      console.error('VynForm error:', vynResult);
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
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, function () {
  console.log('Contact API running on port ' + PORT);
});
