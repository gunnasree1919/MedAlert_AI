const { useState, useEffect, useMemo, useCallback, useRef } = React;

// ── DATABASE ────────────────────────────────────────────────────
// ── DATABASE (FULL CSV DATASET LOADER) ───────────────────────────

// Tables (same structure expected by your existing app)

// ── DATABASE (FULL CSV DATASET LOADER SAFE VERSION) ─────────────

const DB_PATIENTS = [];
const DB_VITALS = {};
const NAMES = {};

let DATA_READY = false;

function isAlarmRaised(v) {
  return Number(v) === 1;
}


// Safe dataset loader

async function loadDataset() {

  try {

    console.log("📂 Loading DATA_FINAL_with_date_time.csv ...");

    const res = await fetch("DATA_FINAL_with_date_time.csv");

    if (!res.ok) {

      console.error("❌ CSV file not found");
      return;

    }

    const csv = await res.text();

   const rows = csv.trim().split(/\r?\n/).slice(1);

    rows.forEach(line => {

      if (!line.trim()) return;

      const cols = line.split(",");

      const pid = Number(cols[0]);

      // add patient once

      if (!DB_PATIENTS.find(p => p.PID === pid)) {

        DB_PATIENTS.push({

          PID: pid,
          GEN: cols[1],
          AGE: Number(cols[2]),
          HD: Number(cols[3]),
          AST: Number(cols[4]),
          DIA: Number(cols[5])

        });

        NAMES[String(pid)] = "Patient " + pid;

      }

      // store vitals

      if (!DB_VITALS[String(pid)]) {

        DB_VITALS[String(pid)] = [];

      }

      DB_VITALS[String(pid)].push([

        Number(cols[15]),
        Number(cols[16]),
        Number(cols[17]),
        Number(cols[18]),
        Number(cols[19]),
        Number(cols[22])

      ]);

    });

    DATA_READY = true;

    console.log("✅ Dataset loaded");
    console.log("👥 Patients:", DB_PATIENTS.length);

  }

  catch (err) {

    console.error("❌ CSV load error:", err);

  }

}


// start loading dataset

loadDataset();
// ── DB API LAYER (REQUIRED FOR APP TO WORK) ─────────────

const DB = {

  stats() {

    return {

      pts: DB_PATIENTS.length,

      reads: Object.values(DB_VITALS)
        .reduce((s, a) => s + a.length, 0)

    };

  },

  patient(pid) {

    return DB_PATIENTS.find(p => p.PID === Number(pid));

  },

  readings(pid) {

    const rows = DB_VITALS[String(pid)] || [];

    return rows.map(r => ({

      BT: r[0],
      OSR: r[1],
      HR: r[2],
      RR: r[3],
      BP: r[4],
      AR: isAlarmRaised(r[5]) ? 1 : 0

    }));

  },

  latest() {

    return DB_PATIENTS.map(p => {

      const last = (DB_VITALS[String(p.PID)] || []).slice(-1)[0] || [];

      return {

        PID: p.PID,
        AGE: p.AGE,
        BT: last[0] || 98.6,
        OSR: last[1] || 98,
        HR: last[2] || 72,
        RR: last[3] || 16,
        BP: last[4] || 110,
        AR: isAlarmRaised(last[5]) ? 1 : 0

      };

    });

  },

  name(pid) {

    return NAMES[String(pid)] || ("Patient " + pid);

  }

};

// ── VITALS CHECK ────────────────────────────────────────────────
function checkVitals(v) {
  const f = [];
  if (v.BT  > 100.5) f.push({msg:"Fever "+v.BT+"°F",        sev:"C"});
  if (v.HR  > 100)   f.push({msg:"High HR "+v.HR+"bpm",      sev:"C"});
  if (v.HR  < 55)    f.push({msg:"Low HR "+v.HR+"bpm",       sev:"C"});
  if (v.OSR < 94)    f.push({msg:"Low SpO₂ "+v.OSR+"%",      sev:"C"});
  if (v.BP  < 90)    f.push({msg:"Low BP "+v.BP+"mmHg",      sev:"W"});
  if (v.BP  > 130)   f.push({msg:"High BP "+v.BP+"mmHg",     sev:"W"});
  if (v.RR  > 30)    f.push({msg:"High RR "+v.RR+"/min",     sev:"W"});
  if (isAlarmRaised(v.AR)) f.push({msg:"DB alarm flagged",     sev:"C"});
  return f;
}

// ── SOUND ───────────────────────────────────────────────────────
let _ac = null;
function beep(type) {
  try {
    if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = _ac.createOscillator(), g = _ac.createGain();
    o.connect(g); g.connect(_ac.destination);
    const t = _ac.currentTime;
    if (type === "C") {
      o.frequency.setValueAtTime(880,t); o.frequency.setValueAtTime(440,t+.15); o.frequency.setValueAtTime(880,t+.3);
      g.gain.setValueAtTime(.35,t); g.gain.exponentialRampToValueAtTime(.001,t+.6);
      o.start(t); o.stop(t+.6);
    } else if (type === "W") {
      o.frequency.setValueAtTime(660,t);
      g.gain.setValueAtTime(.2,t); g.gain.exponentialRampToValueAtTime(.001,t+.4);
      o.start(t); o.stop(t+.4);
    } else {
      o.frequency.setValueAtTime(523,t); o.frequency.setValueAtTime(659,t+.1);
      g.gain.setValueAtTime(.2,t); g.gain.exponentialRampToValueAtTime(.001,t+.3);
      o.start(t); o.stop(t+.3);
    }
  } catch(e) {}
}

// ── LIVE VITALS HOOK ────────────────────────────────────────────
function useLive(ms, pid, onRead) {
  const [dataReady, setDataReady] = useState(DATA_READY);
  const reads = useMemo(() => (dataReady ? DB.readings(pid) : []), [pid, dataReady]);
  const [v, setV]         = useState(reads[0] || {BT:98.6,OSR:98,HR:72,RR:16,BP:110,AR:0});
  const [cd, setCd]       = useState(ms/1000);
  const [flash, setFlash] = useState(false);
  const [ri, setRi]       = useState(0);
  const cbRef = useRef(onRead);
  useEffect(() => { cbRef.current = onRead; }, [onRead]);
  useEffect(() => {
    if (DATA_READY) {
      setDataReady(true);
      return;
    }
    const t = setInterval(() => {
      if (DATA_READY) {
        setDataReady(true);
        clearInterval(t);
      }
    }, 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setCd(p => p <= 1 ? ms/1000 : p-1), 1000);
    return () => clearInterval(t);
  }, [ms]);
  useEffect(() => {
    if (!reads.length) return;
    setRi(0); setV(reads[0]); setCd(ms/1000);
    const t = setInterval(() => {
      setRi(p => {
        const n = (p+1) % reads.length;
        const nv = reads[n];
        setV(nv); setCd(ms/1000);
        setFlash(true); setTimeout(() => setFlash(false), 400);
        if (cbRef.current) cbRef.current(nv, checkVitals(nv), n);
        return n;
      });
    }, ms);
    return () => clearInterval(t);
  }, [reads, ms]);
  return {...v, cd, flash, ri, total:reads.length};
}

// ── TOAST HOOK ──────────────────────────────────────────────────
function useToasts() {
  const [ts, set] = useState([]);
  const add = useCallback(t => {
    const id = Date.now() + Math.random();
    set(p => [...p, {...t, id}]);
    setTimeout(() => set(p => p.filter(x => x.id !== id)), t.dur || 5000);
  }, []);
  const rm = useCallback(id => set(p => p.filter(t => t.id !== id)), []);
  return {ts, add, rm};
}

// ── TWILIO SMS ALERTS ───────────────────────────────────────────
// Twilio credentials (sender via Node.js server.js on localhost:3000)
const TWILIO_FROM = "+14782159296";

const _vCooldown = {};  // vitals alert cooldown per patient (1 sec per alert)
const _sCooldown = {};  // SOS cooldown per patient (30 sec)

// Convert any Indian number format → E.164 (+91XXXXXXXXXX)
function toE164(num) {
  if (!num) return null;
  const c = String(num).replace(/[\s\-()]/g, "");
  if (c.startsWith("+") && /^\+\d{8,15}$/.test(c)) return c;
  if (c.startsWith("91") && c.length === 12 && /^\d+$/.test(c)) return "+" + c;
  if (c.length === 10 && /^[6-9]\d{9}$/.test(c)) return "+91" + c;
  if (c.length === 11 && c.startsWith("1") && /^\d{11}$/.test(c)) return "+" + c;
  if (c.length === 10 && /^\d{10}$/.test(c)) return "+1" + c;
  return null;
}

// Build recipient list from patient profile (deduped)
function buildRecipients(doctorPhone, ecPhone) {
  const seen = new Set();
  const list = [];

  const add = (raw, label) => {
    const e164 = toE164(raw);
    if (!e164) {
      console.warn("[SMS] ⚠️ Invalid number for", label, "→", raw);
      return;
    }
    if (seen.has(e164)) return;
    seen.add(e164);
    list.push({ number: e164, label });
    console.log("[SMS] ✔ Recipient added →", label, ":", e164);
  };

  add(doctorPhone, "Doctor");
  add(ecPhone,     "Emergency Contact");
  return list;
}

// Send ONE SMS via server.js — returns Promise<{ok, sid, error}>
async function sendOneSMS(to, body, label) {

  console.log("[SMS] Sending to", label, "("+to+") ...");

  try {

    const res = await fetch("http://localhost:3000/send-sms", {

      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        to: to,
        body: body
      })

    });

    const data = await res.json();

   if (data.sid || data.status === "queued"){

      console.log("✅ SMS sent →", label);

      return {
        ok: true,
        sid: data.sid,
        label
      };

    } else {

      console.error("❌ Twilio rejected →", label);

      return {
        ok: false,
        error: data.error || "Twilio rejected request",
        label
      };

    }

  } catch (err) {

    console.error("❌ Server not running");

    return {
      ok: false,
      error: "server.js not running",
      label
    };

  }

}
// Fire alerts to all recipients, return Promise<results[]>
async function fireAlerts(patientName, patientId, issueText, doctorPhone, ecPhone) {
  const msgBody = "🚨 CRITICAL ALERT: " + issueText;

  const recipients = buildRecipients(doctorPhone, ecPhone);

  if (recipients.length === 0) {
    console.error("[SMS] ❌ No valid recipients! Check doctor/EC phone numbers at login.");
    return [];
  }

  console.log("[SMS] 🚨 Firing alert to", recipients.length, "recipient(s):", recipients.map(r=>r.label).join(", "));

  const results = await Promise.all(
    recipients.map(r => sendOneSMS(r.number, msgBody, r.label))
  );

  const sent   = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);

  if (sent.length > 0)   console.log("[SMS] ✅ Sent successfully to:", sent.map(r=>r.label).join(", "));
  if (failed.length > 0) console.error("[SMS] ❌ Failed for:", failed.map(r=>r.label+" ("+r.error+")").join(", "));

  return results;
}

// Called on critical vitals (1-sec cooldown per patient)
function alertCritical(name, pid, flags, docPhone, ecPhone) {
  if (!flags || flags.length === 0) return;

  const now = Date.now();
  const lastAlert = _vCooldown[pid] || 0;
  const cooldownMs = 1000; // 1 sec between repeated alerts

  if (now - lastAlert < cooldownMs) {
    const waitMs = cooldownMs - (now - lastAlert);
    console.log("[SMS] ⏳ Alert cooldown for PID", pid, "— wait", Math.round(waitMs), "ms");
    return;
  }

  _vCooldown[pid] = now;
  fireAlerts(name, pid, flags.map(f => f.msg).join(", "), docPhone, ecPhone);
}

// Called on SOS button press (30-sec cooldown per patient)
function alertSOS(name, pid, docPhone, ecPhone) {
  const now = Date.now();
  if (now - (_sCooldown[pid] || 0) < 30000) {
    console.log("[SMS] ⏳ SOS cooldown active for PID", pid);
    return;
  }
  _sCooldown[pid] = now;
  fireAlerts(name, pid, "SOS button pressed by patient", docPhone, ecPhone);
}

// ── CSS ─────────────────────────────────────────────────────────
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0d1a;color:rgba(255,255,255,.92);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.shell{max-width:430px;margin:0 auto;height:100vh;display:flex;flex-direction:column;background:#0d0d1a;overflow:hidden}
.scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
.page{padding:16px 18px}
.card{background:#1e2a45;border:1.5px solid rgba(255,255,255,.08);border-radius:18px;padding:14px}
.card.crit{border-color:rgba(230,57,70,.45);background:rgba(230,57,70,.05)}
.hdr{background:linear-gradient(135deg,#0d0d1a,#1a1a2e);padding:13px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0}
.logo{font-size:18px;font-weight:900;color:#fff}.logo span{color:#e63946}
.nav{display:flex;background:#0f0f1f;border-top:1px solid rgba(255,255,255,.08);flex-shrink:0;padding:4px 6px}
.nb{flex:1;padding:8px 4px;background:none;border:none;color:rgba(255,255,255,.22);cursor:pointer;border-radius:10px;display:flex;flex-direction:column;align-items:center;gap:2px;position:relative}
.nb.on{background:rgba(230,57,70,.12);color:#e63946}
.ic{font-size:19px}.lb{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.5px}
.bdg{position:absolute;top:3px;right:calc(50% - 18px);width:14px;height:14px;background:#e63946;border-radius:50%;font-size:8px;color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center}
.vg{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.vc{background:#1e2a45;border:1.5px solid rgba(255,255,255,.08);border-radius:18px;padding:13px 8px;text-align:center;position:relative;transition:all .3s}
.vc.al{border-color:rgba(230,57,70,.5);background:rgba(230,57,70,.06)}
.vdot{position:absolute;top:7px;right:7px;width:6px;height:6px;border-radius:50%}
.vval{font-size:21px;font-weight:900;color:#fff;line-height:1}.vval.al{color:#e63946}
.dtab{display:flex;overflow-x:auto;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0}
.dt{padding:9px 13px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.3);cursor:pointer;border:none;border-bottom:2px solid transparent;background:none;white-space:nowrap;transition:all .2s;position:relative}
.dt.on{color:#fff;border-bottom-color:#e63946}
.field{width:100%;padding:13px 15px;background:#1e2a45;border:1.5px solid rgba(255,255,255,.08);border-radius:13px;color:rgba(255,255,255,.92);font-size:14px;outline:none}
.field:focus{border-color:rgba(230,57,70,.4)}
.btnR{padding:13px 20px;border:none;border-radius:13px;font-weight:800;font-size:13px;cursor:pointer;background:#e63946;color:#fff;width:100%}
.btnR:disabled{opacity:.4;cursor:not-allowed}
.rc{
border:1.5px solid rgba(255,255,255,.08);
border-radius:18px;
padding:15px;
cursor:pointer;
text-align:center;
background:#1e2a45;
color:white;
font-weight:700;
}
.rc.on{border-color:#e63946;background:rgba(230,57,70,.08)}
.tbl{width:100%;border-collapse:collapse}
.th{padding:6px 8px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.22);border-bottom:1px solid rgba(255,255,255,.08);text-align:left}
.td{padding:5px 7px;font-size:10px;font-family:monospace;border-bottom:1px solid rgba(255,255,255,.03)}
.err{font-size:10px;color:#e63946;font-weight:700;margin-bottom:6px;padding-left:4px}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.2)}}
@keyframes hb{0%,100%{transform:scale(1)}15%{transform:scale(1.25)}30%{transform:scale(1)}}
@keyframes sIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
@keyframes ring{0%{box-shadow:0 0 0 0 rgba(230,57,70,.7)}70%{box-shadow:0 0 0 28px rgba(230,57,70,0)}100%{box-shadow:0 0 0 0 rgba(230,57,70,0)}}
@keyframes cdAnim{from{transform:scale(1.5);opacity:0}to{transform:scale(1);opacity:1}}
`;

const R="#e63946", G="#52b788", A="#4cc9f0", Y="#f4a261";

// ── TOASTS UI ───────────────────────────────────────────────────
function Toasts({ts, rm}) {
  return (
    <div style={{position:"fixed",top:12,left:12,right:12,zIndex:9999,display:"flex",flexDirection:"column",gap:8}}>
      {ts.slice(-3).map(t => (
        <div key={t.id} onClick={() => rm(t.id)}
          style={{background:t.type==="C"?"#1a0505":t.type==="W"?"#1a1205":"#051a0a",
            border:"1.5px solid "+(t.type==="C"?R:t.type==="W"?Y:G),
            borderRadius:14,padding:"10px 14px",cursor:"pointer",animation:"sIn .3s",boxShadow:"0 6px 24px rgba(0,0,0,.6)"}}>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <span style={{fontSize:18}}>{t.icon}</span>
            <div>
              <div style={{fontWeight:800,fontSize:11,color:"#fff"}}>{t.title}</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,.6)",marginTop:2}}>{t.msg}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── EC ALERT POPUP ───────────────────────────────────────────────
function ECAlert({contact, doctorPhone, vitals, flags, onDismiss, onSend}) {
  const [status, setStatus] = useState("idle"); // idle | sending | done | error
  const [results, setResults] = useState([]);
  const docNum  = toE164(doctorPhone);
  const ecNum   = toE164(contact?.phone);

  async function handleSend() {
    setStatus("sending");
    console.log("[ECAlert] Sending SMS to Doctor:", docNum, "& EC:", ecNum);
    const res = onSend
      ? await onSend()
      : await fireAlerts(
          "Patient",
          "PID-" + Date.now(),
          "Critical alert triggered",
          doctorPhone,
          contact?.phone
        );
    setResults(res);
    const anyOk = res.some(r => r.ok);
    setStatus(anyOk ? "done" : "error");
    if (anyOk) setTimeout(onDismiss, 3000);
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"#1a0505",border:"2px solid "+R,borderRadius:20,padding:20,width:"100%",maxWidth:340,animation:"sIn .3s"}}>
        <div style={{textAlign:"center",marginBottom:14}}>
          <div style={{fontSize:40,animation:"pulse .8s infinite"}}>🚨</div>
          <div style={{fontSize:16,fontWeight:900,color:"#fff",marginTop:6}}>Critical Alert!</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,.4)",marginTop:4}}>SMS sending to both contacts</div>
        </div>

        {/* Show BOTH contacts */}
        <div style={{background:"rgba(255,255,255,.05)",borderRadius:12,padding:12,marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:800,color:"rgba(255,255,255,.5)",textTransform:"uppercase",marginBottom:8}}>📱 Alerting</div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,.08)"}}>
            <div>
              <div style={{fontSize:11,fontWeight:800,color:"#fff"}}>👨‍⚕️ Doctor</div>
              <div style={{fontSize:10,color:A,fontFamily:"monospace",marginTop:1}}>{docNum || "Not set"}</div>
            </div>
            <span style={{fontSize:14}}>{docNum ? "✅" : "⚠️"}</span>
          </div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0"}}>
            <div>
              <div style={{fontSize:11,fontWeight:800,color:"#fff"}}>🆘 Emergency Contact</div>
              <div style={{fontSize:10,color:A,fontFamily:"monospace",marginTop:1}}>{ecNum || "Not set"}</div>
            </div>
            <span style={{fontSize:14}}>{ecNum ? "✅" : "⚠️"}</span>
          </div>
        </div>

        <div style={{background:"rgba(230,57,70,.08)",border:"1px solid rgba(230,57,70,.2)",borderRadius:10,padding:10,marginBottom:12}}>
          {flags.map((f,i) => <div key={i} style={{fontSize:10,color:"rgba(255,255,255,.75)",marginBottom:2}}>⚠️ {f.msg}</div>)}
        </div>

        {status === "idle" && (
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{fontSize:11,color:"rgba(255,255,255,.7)",textAlign:"center"}}>
              Alert is auto-sent only when a critical event is detected.
            </div>
            <button onClick={onDismiss} style={{padding:10,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,color:"rgba(255,255,255,.5)",fontSize:12,fontWeight:700,cursor:"pointer"}}>Close</button>
          </div>
        )}
        {status === "sending" && (
          <div style={{textAlign:"center",padding:12,color:"rgba(255,255,255,.6)",fontSize:12}}>
            <div style={{fontSize:20,marginBottom:6,animation:"pulse .8s infinite"}}>📡</div>
            Sending SMS via Twilio…
          </div>
        )}
        {status === "done" && (
          <div>
            {results.map((r,i) => (
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:i<results.length-1?"1px solid rgba(255,255,255,.08)":"none"}}>
                <span style={{fontSize:11,color:"rgba(255,255,255,.7)"}}>{r.label}</span>
                <span style={{fontSize:11,color:r.ok?G:R,fontWeight:800}}>{r.ok?"✅ Sent":"❌ Failed"}</span>
              </div>
            ))}
          </div>
        )}
        {status === "error" && (
          <div style={{background:"rgba(230,57,70,.1)",border:"1px solid rgba(230,57,70,.3)",borderRadius:10,padding:10}}>
            <div style={{fontSize:11,fontWeight:800,color:R,marginBottom:4}}>❌ SMS Failed</div>
            {results.map((r,i) => (
              <div key={i} style={{fontSize:10,color:"rgba(255,255,255,.6)",marginBottom:2}}>{r.label}: {r.error}</div>
            ))}
            <div style={{fontSize:9,color:"rgba(255,255,255,.4)",marginTop:6}}>
              Make sure <span style={{fontFamily:"monospace",color:"#f4a261"}}>node server.js</span> is running on your machine
            </div>
            <button onClick={onDismiss} style={{marginTop:8,width:"100%",padding:"8px",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,color:"rgba(255,255,255,.5)",fontSize:11,fontWeight:700,cursor:"pointer"}}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── REGISTER PAGE (ROLE BASED) ───────────────────────────────
function Auth({ goLogin }) {

const [role,setRole]=useState("P");

const [form,setForm]=useState({
name:"",
age:"",
gender:"",
blood:"",
docPhone:"",
ecPhone:"",
spec:""
});


function register(){

if(!form.name){
alert("Enter name");
return;
}


if(!/^[6-9]\d{9}$/.test(form.docPhone)){
alert("Doctor phone must be valid 10-digit number");
return;
}

if(role==="P" && !/^[6-9]\d{9}$/.test(form.ecPhone)){
alert("Emergency contact must be valid 10-digit number");
return;
}

localStorage.setItem(
"registered_user",
JSON.stringify({
...form,
role,
pid: DB_PATIENTS[0]?.PID || 1,
doctorPhone: form.docPhone,
ecPhone: role==="P" ? form.ecPhone : null,
})
);

goLogin();

}


return(

<div className="shell">

<div className="page">

<div className="logo" style={{fontSize:36,textAlign:"center"}}>
MedAlert AI
</div>


{/* ROLE SELECT */}
<div style={{
display:"grid",
gridTemplateColumns:"1fr 1fr",
gap:10,
marginTop:20
}}>

<button
className={"rc"+(role==="P"?" on":"")}
onClick={()=>setRole("P")}
style={{color:"#fff", fontWeight:"700"}}
>
👤 Patient Register
</button>

<button
className={"rc"+(role==="D"?" on":"")}
onClick={()=>setRole("D")}
style={{color:"#fff", fontWeight:"700"}}
>
👨‍⚕️ Doctor Register
</button>

</div>


<input
className="field"
placeholder="Full Name"
value={form.name}
onChange={e=>setForm({...form,name:e.target.value})}
style={{marginTop:14}}
/>


{/* PATIENT ONLY FIELDS */}
{role==="P" && (

<>

<input
className="field"
placeholder="Age"
value={form.age}
onChange={e=>setForm({...form,age:e.target.value})}
style={{marginTop:10}}
/>

<select
className="field"
value={form.gender}
onChange={e=>setForm({...form,gender:e.target.value})}
style={{marginTop:10}}
>

<option value="">Select Gender</option>
<option>Male</option>
<option>Female</option>
<option>Other</option>

</select>


<select
className="field"
value={form.blood || ""}
onChange={e=>setForm({...form,blood:e.target.value})}
style={{marginTop:10}}
>

<option value="">Blood Group</option>
<option>A+</option>
<option>A-</option>
<option>B+</option>
<option>B-</option>
<option>O+</option>
<option>O-</option>
<option>AB+</option>
<option>AB-</option>

</select>


<input
className="field"
placeholder="Medical Conditions (ex: Diabetes, BP)"
value={form.conditions || ""}
onChange={e=>setForm({...form,conditions:e.target.value})}
style={{marginTop:10}}
/>

</>

)}


{/* DOCTOR ONLY FIELD */}
{role==="D" && (

<input
className="field"
placeholder="Specialization"
value={form.spec}
onChange={e=>setForm({...form,spec:e.target.value})}
style={{marginTop:10}}
/>

)}


{/* CONTACTS REQUIRED FOR BOTH */}
<input
className="field"
placeholder="Doctor Phone (10 digits)"
maxLength={10}
style={{marginTop:10}}
value={form.docPhone}
onChange={e=>{
const val=e.target.value.replace(/\D/g,"");
setForm({...form,docPhone:val});
}}
/>


{role==="P" && (
<input
className="field"
placeholder="Emergency Contact Phone"
maxLength={10}
style={{marginTop:10}}
value={form.ecPhone}
onChange={e=>{
const val=e.target.value.replace(/\D/g,"");
setForm({...form,ecPhone:val});
}}
/>
)}

<button
className="btnR"
style={{marginTop:16}}
onClick={register}
>
Register →
</button>


<button
style={{
marginTop:10,
background:"none",
border:"none",
color:"#fff"
}}
onClick={goLogin}
>
Already registered? Login
</button>


</div>

</div>

);

}
// ── LOGIN PAGE ─────────────────────────────────────────────
function Login({ onLogin }) {

const savedUser =
JSON.parse(localStorage.getItem("registered_user"));
console.log("LOGIN ROLE =", savedUser?.role);

const role = savedUser?.role || "P";

const [name,setName]=useState("");
const [docPhone,setDocPhone]=useState("");
const [ecPhone,setEcPhone]=useState("");

function login(){

const savedUser =
JSON.parse(localStorage.getItem("registered_user"));

if(!savedUser){
alert("Please register first");
return;
}

if(name !== savedUser.name){
alert("Name mismatch");
return;
}

if(docPhone !== savedUser.docPhone){
alert("Doctor phone mismatch");
return;
}

if(savedUser.role==="P" && ecPhone !== savedUser.ecPhone){
alert("Emergency phone mismatch");
return;
}

onLogin({
...savedUser,
pid: DB.patient(savedUser.pid) ? savedUser.pid : (DB_PATIENTS[0]?.PID || 1),
doctorPhone: savedUser.docPhone,
ec: savedUser.role === "P" && savedUser.ecPhone
? [{ phone: savedUser.ecPhone }]
: []
});

}

return(

<div className="shell">

<div className="page">

<div className="logo"
style={{fontSize:36,textAlign:"center"}}>
MedAlert AI
</div>

<input
className="field"
placeholder="Full Name"
value={name}
onChange={e=>setName(e.target.value)}
style={{marginTop:14}}
/>

<input
className="field"
placeholder="Doctor Phone"
maxLength={10}
value={docPhone}
onChange={e=>setDocPhone(
e.target.value.replace(/\D/g,"")
)}
style={{marginTop:10}}
/>

{role==="P" && (
<input
className="field"
placeholder="Emergency Phone"
maxLength={10}
value={ecPhone}
onChange={e=>setEcPhone(
e.target.value.replace(/\D/g,"")
)}
style={{marginTop:10}}
/>
)}
<button
className="btnR"
style={{marginTop:16}}
onClick={login}
>
Login →
</button>

</div>

</div>

);

}

 
// ── PATIENT APP ──────────────────────────────────────────────────
function PatApp({u, logout, toast}) {
  const [tab,   setTab]  = useState("H");
  const [apptStep,setApptStep]=useState("menu");
const [selectedDoctor,setSelectedDoctor]=useState("");
const [selectedSlot,setSelectedSlot]=useState("");
const [selectedDate,setSelectedDate]=useState("");
  const [ecA,   setEcA]  = useState(null);
  const [cf,    setCf]   = useState(false);
  const [sosCd, setSosCd]= useState(null);
  const [sosOn, setSosOn]= useState(false);
  const [log,   setLog]  = useState([]);
  const prev = useRef([]);
  const ini = u.name.split(" ").map(w=>w[0]).slice(0,2).join("");

  const onRead = useCallback((nv, fl, ri) => {
    const crit = fl.some(f => f.sev === "C");
    setLog(p => [{id:Date.now(),ri,
      time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}),
      v:{...nv}, fl, crit}, ...p].slice(0,40));
    if (fl.length > 0) {
      toast({type:crit?"C":"W", icon:crit?"🚨":"⚠️",
        title:crit?"🚨 Critical Vitals":"⚠️ Abnormal Vitals",
        msg:fl.map(f=>f.msg).join(" · "), dur:7000});
      if (crit) {
        beep("C"); setCf(true); setTimeout(()=>setCf(false), 500);
        setEcA({v:nv, fl});
        // 🚨 SMS to Doctor + Emergency Contact only
        alertCritical(
          u.name,
          u.pid,
          fl,
          u.doctorPhone,
          u.ec?.[0]?.phone || null
        );
      } else beep("W");
    }
    prev.current = fl;
  }, [toast, u]);

  const lv = useLive(20000, String(u.pid||1), onRead);
  const {cd, flash, ri, total} = lv;
  const flags  = checkVitals(lv);
  const isCrit = isAlarmRaised(lv.AR) || flags.some(f=>f.sev==="C");

  const vt = [
    {lb:"BT",  ic:"🌡️", val:lv.BT,  un:"°F",   al:lv.BT>100.5},
    {lb:"HR",  ic:"❤️",  val:lv.HR,  un:"bpm",  al:lv.HR>100||lv.HR<55},
    {lb:"RR",  ic:"🫁",  val:lv.RR,  un:"/min", al:lv.RR>30},
    {lb:"BP",  ic:"💉",  val:lv.BP,  un:"mmHg", al:lv.BP<90||lv.BP>130},
    {lb:"SpO₂",ic:"🩸",  val:lv.OSR, un:"%",    al:lv.OSR<94},
  ];

  // SOS countdown
  useEffect(() => {
    if (sosCd === null) return;
    if (sosCd === 0) {
      setSosCd(null); setSosOn(true); beep("C");
      toast({type:"C",icon:"🆘",title:"SOS DISPATCHED",msg:"SMS sent to Doctor & Emergency Contact",dur:10000});
      setEcA({v:lv, fl:[{msg:"SOS pressed by "+u.name, sev:"C"}]});
      // 🚨 SMS on SOS to Doctor + Emergency Contact only
      alertSOS(u.name, u.pid, u.doctorPhone, u.ec?.[0]?.phone);
      return;
    }
    const t = setTimeout(() => setSosCd(p => p-1), 1000);
    return () => clearTimeout(t);
  }, [sosCd]);

  const TABS = [
  {id:"H", ic:"🏠", lb:"Home"},
  {id:"V", ic:"📊", lb:"Readings"},
  {id:"X", ic:"📍", lb:"Services"},   // ✅ ADD THIS LINE
  {id:"A", ic:"🔔", lb:"Alerts", badge:log.filter(l=>l.crit).length},
  {id:"S", ic:"🆘", lb:"SOS", red:true},
];

  return (
    <div className="shell">
      {cf && <div style={{position:"fixed",inset:0,background:"rgba(230,57,70,.15)",zIndex:9990,pointerEvents:"none",animation:"sIn .5s"}}/>}
      {ecA && <ECAlert
        contact={u.ec?.[0]}
        doctorPhone={u.doctorPhone}
        vitals={ecA.v}
        flags={ecA.fl}
        onDismiss={()=>setEcA(null)}
        onSend={()=>fireAlerts(u.name, u.pid, ecA.fl.map(f=>f.msg).join(", "), u.doctorPhone, u.ec?.[0]?.phone)}
      />}
      {sosCd !== null && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:9995,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
          <div style={{fontSize:110,fontWeight:900,color:R,animation:"cdAnim .7s ease",lineHeight:1}}>{sosCd}</div>
          <div style={{fontSize:15,color:"rgba(255,255,255,.6)",marginTop:12,fontWeight:700}}>Sending SOS…</div>
          <button onClick={()=>setSosCd(null)} style={{marginTop:20,padding:"10px 24px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:10,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Cancel</button>
        </div>
      )}

      {/* Header */}
      <div className="hdr">
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,borderRadius:10,background:"linear-gradient(135deg,"+R+",#7209b7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,color:"#fff"}}>{ini}</div>
          <div><div className="logo">MedAlert AI</div><div style={{fontSize:8,color:"rgba(255,255,255,.5)",fontWeight:700,textTransform:"uppercase",letterSpacing:"1px"}}>Patient Portal</div></div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {isCrit && <span style={{fontSize:18,animation:"pulse .8s infinite"}}>🚨</span>}
          <button onClick={logout} style={{width:30,height:30,borderRadius:8,background:"rgba(255,255,255,.08)",border:"none",cursor:"pointer",color:"rgba(255,255,255,.5)",fontSize:13}}>←</button>
        </div>
      </div>

      <div className="scroll">
        {/* HOME */}
{tab==="H" && (
<div className="page">

{/* PROFILE CARD */}
<div className="card" style={{display:"flex",alignItems:"center",gap:14,marginBottom:14}}>
<div style={{
width:50,
height:50,
borderRadius:15,
background:"linear-gradient(135deg,"+R+",#7209b7)",
display:"flex",
alignItems:"center",
justifyContent:"center",
fontSize:17,
fontWeight:900,
color:"#fff"
}}>
{ini}
</div>

<div style={{flex:1}}>
<div style={{fontSize:16,fontWeight:900}}>
{u.name}
</div>
<div style={{
  fontSize:10,
  color:"rgba(255,255,255,.5)",
  marginTop:2
}}>
  🧬 Condition: {u?.conditions || "None"}
</div>

<div style={{fontSize:10,color:"rgba(255,255,255,.5)",marginTop:2}}>
{u.pid} · {u.gender} · Age {u.age}
</div>

{u.doctorPhone && (
<div style={{fontSize:9,color:A,fontFamily:"monospace",marginTop:2}}>
👨‍⚕️ Dr: {toE164(u.doctorPhone)}
</div>
)}
</div>

{isCrit && (
<span style={{fontSize:22,animation:"pulse .8s infinite"}}>
🚨
</span>
)}
</div>



{/* ALERT STATUS */}
<div className="card" style={{marginBottom:14}}>
<div style={{fontSize:12,fontWeight:800,marginBottom:6}}>
🔔 Alerts Check
</div>

<div style={{fontSize:11,color:"rgba(255,255,255,.7)"}}>
{flags.length === 0
? "No active alerts"
: flags.map(f => "⚠️ " + f.msg).join(" · ")
}
</div>
</div>


{/* CRITICAL ALERT MESSAGE */}
{isCrit && (
<div style={{
display:"flex",
gap:12,
background:"rgba(230,57,70,.06)",
border:"1px solid rgba(230,57,70,.25)",
borderRadius:13,
padding:"11px 13px",
marginBottom:12
}}>
<div style={{
width:8,
height:8,
borderRadius:"50%",
background:R,
animation:"pulse .8s infinite"
}}/>

<div>
<div style={{fontSize:11,fontWeight:800,color:R}}>
⚠️ Critical Vitals — SMS Sent
</div>

<div style={{fontSize:10,color:"rgba(255,255,255,.5)"}}>
{flags.map(f=>f.msg).join(" · ")}
</div>
</div>
</div>
)}


{/* SOS BUTTON */}
<button
onClick={()=>setTab("S")}
style={{
width:"100%",
padding:"15px 18px",
background:isCrit?R:"#1e2a45",
border:"1.5px solid "+(isCrit?R:"rgba(255,255,255,.08)"),
borderRadius:18,
color:"#fff",
display:"flex",
justifyContent:"space-between",
marginBottom:14
}}
>

<div>
<div style={{fontSize:18,fontWeight:900}}>
Emergency SOS
</div>

<div style={{fontSize:10,opacity:.6}}>
3-second countdown · SMS to Doctor & EC
</div>
</div>

<span style={{fontSize:28}}>
🆘
</span>

</button>


{/* LIVE TELEMETRY HEADER */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
<span style={{fontSize:12,fontWeight:800}}>
Live Telemetry
</span>

<span style={{display:"flex",alignItems:"center",gap:5}}>
<span style={{
width:7,
height:7,
borderRadius:"50%",
background:isCrit?R:G,
animation:"pulse .8s infinite"
}}/>

<span style={{fontSize:10,fontWeight:700,color:isCrit?R:G}}>
{isCrit?"CRITICAL":"LIVE"}
</span>
</span>
</div>


{/* COUNTDOWN BAR */}
<div className="card" style={{marginBottom:12}}>
<div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
<span style={{fontSize:10}}>
Reading {ri+1}
</span>

<span style={{fontFamily:"monospace"}}>
⏱ {Math.floor(cd/60)}:{String(cd%60).padStart(2,"0")}
</span>
</div>

<div style={{
height:4,
background:"rgba(255,255,255,.06)",
borderRadius:2
}}>
<div style={{
height:"100%",
width:(cd/8*100)+"%",
background:isCrit?R:G
}}/>
</div>
</div>


{/* VITALS GRID */}
<div className="vg" style={{marginBottom:14}}>
{vt.map(v => (
<div key={v.lb} className={"vc"+(v.al?" al":"")}>

<div className="vdot"
style={{background:v.al?R:G}}
/>

<span style={{fontSize:17}}>
{v.ic}
</span>

<div className={"vval"+(v.al?" al":"")}>
{v.val}
</div>

<div style={{fontSize:8}}>
{v.un}
</div>

<div style={{fontSize:8}}>
{v.lb}
</div>

</div>
))}
</div>


{/* ALERT CONTACTS */}
<div className="card">

<div style={{fontSize:10,fontWeight:800,marginBottom:8}}>
📱 Alert Contacts
</div>

<div style={{display:"flex",justifyContent:"space-between"}}>
<span>👨‍⚕️ Doctor</span>
<span style={{color:A,fontFamily:"monospace"}}>
{toE164(u.doctorPhone) || "Not set"}
</span>
</div>

<div style={{display:"flex",justifyContent:"space-between"}}>
<span>🆘 Emergency</span>
<span style={{color:A,fontFamily:"monospace"}}>
{toE164(u.ec?.[0]?.phone) || "Not set"}
</span>
</div>

</div>

</div>
)}
{/* SERVICES PAGE */}
{tab==="X" && (
<div className="page">

{/* MENU */}
{apptStep==="menu" && (
<>
<div
className="card"
style={{marginBottom:12,cursor:"pointer"}}
onClick={()=>setApptStep("specialist")}
>
📅 Schedule Appointment
</div>

<div
className="card"
style={{cursor:"pointer"}}
onClick={()=>setApptStep("existing")}
>
🗂 View My Appointments
</div>
</>
)}


{/* SELECT SPECIALIST */}
{apptStep==="specialist" && (
<>
<div style={{fontWeight:800,marginBottom:10}}>
Select Specialist
</div>

{["Cardiologist","Gynecologist","General Physician","Dermatologist"]
.map(sp=>(
<div
key={sp}
className="card"
style={{marginBottom:10,cursor:"pointer"}}
onClick={()=>setApptStep("doctor")}
>
👨‍⚕️ {sp}
</div>
))}

<button
className="btnR"
onClick={()=>setApptStep("menu")}
>
Back
</button>
</>
)}


{/* SELECT DOCTOR */}
{apptStep==="doctor" && (
<>
<div style={{fontWeight:800,marginBottom:10}}>
Available Doctors
</div>

{["Dr. Sharma","Dr. Reddy","Dr. Kumar"]
.map(doc=>(
<div
key={doc}
className="card"
style={{marginBottom:10,cursor:"pointer"}}
onClick={()=>{
setSelectedDoctor(doc);
setApptStep("date");
}}
>
{doc}
</div>
))}

<button
className="btnR"
onClick={()=>setApptStep("specialist")}
>
Back
</button>
</>
)}


{/* SELECT DATE */}
{apptStep==="date" && (
<>
<div style={{fontWeight:800,marginBottom:10}}>
Select Appointment Date
</div>

<input
type="date"
className="field"
value={selectedDate}
onChange={(e)=>setSelectedDate(e.target.value)}
/>

<button
className="btnR"
style={{marginTop:10}}
disabled={!selectedDate}
onClick={()=>setApptStep("slot")}
>
Continue
</button>

<button
className="btnR"
style={{marginTop:6}}
onClick={()=>setApptStep("doctor")}
>
Back
</button>
</>
)}


{/* SELECT SLOT */}
{apptStep==="slot" && (
<>
<div style={{fontWeight:800,marginBottom:10}}>
Available Slots
</div>

{["10:00 AM","11:30 AM","2:00 PM","4:15 PM"]
.map(slot=>(
<div
key={slot}
className="card"
style={{marginBottom:10,cursor:"pointer"}}
onClick={()=>{

const appointmentData = {
doctor: selectedDoctor,
date: selectedDate,
time: slot
};

const existing =
JSON.parse(localStorage.getItem("appointments")) || [];

existing.push(appointmentData);

localStorage.setItem(
"appointments",
JSON.stringify(existing)
);

setSelectedSlot(slot);
setApptStep("confirm");

}}
>
🕒 {slot}
</div>
))}

<button
className="btnR"
onClick={()=>setApptStep("date")}
>
Back
</button>
</>
)}


{/* CONFIRMATION */}
{apptStep==="confirm" && (
<>
<div className="card">

<div style={{fontWeight:800,fontSize:13}}>
✅ Appointment Booked Successfully
</div>

<div style={{fontSize:11}}>
Doctor: {selectedDoctor}
</div>

<div style={{fontSize:11}}>
Date: {selectedDate}
</div>

<div style={{fontSize:11}}>
Time: {selectedSlot}
</div>

</div>

<button
className="btnR"
onClick={()=>setApptStep("menu")}
>
Back to Menu
</button>
</>
)}


{/* VIEW APPOINTMENTS */}
{apptStep==="existing" && (
<>
<div className="card">

<div style={{fontWeight:800}}>
📅 Your Appointments
</div>

{(() => {

const appts =
JSON.parse(localStorage.getItem("appointments")) || [];

if(appts.length === 0){
return (
<div>No appointment scheduled yet</div>
);
}

return appts.map((a,i)=>(
<div key={i}>
<div style={{fontSize:11}}>
{a.doctor}
</div>

<div style={{fontSize:10,color:"gray"}}>
{a.date} · {a.time}
</div>
</div>
));

})()}

</div>

<button
className="btnR"
onClick={()=>setApptStep("menu")}
>
Back
</button>

</>
)}

</div>
)}
        {/* READINGS */}
        {tab==="V" && (
          <div className="page">
            <div style={{fontSize:13,fontWeight:800,marginBottom:4}}>📊 Minute-by-Minute Readings</div>
            <p style={{fontSize:10,color:"rgba(255,255,255,.5)",marginBottom:12}}>{u.name} · updates every 8s</p>
            <div className={"card"+(isCrit?" crit":"")} style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontSize:10,fontWeight:800,color:"rgba(255,255,255,.5)"}}>READING #{ri+1}</span>
                <span style={{fontSize:9,fontWeight:700,color:isCrit?R:G}}>{isCrit?"⚠️ CRITICAL":"✅ NORMAL"}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5}}>
                {vt.map(v => (
                  <div key={v.lb} style={{background:"rgba(255,255,255,.04)",borderRadius:8,padding:"7px 3px",textAlign:"center",border:"1px solid "+(v.al?"rgba(230,57,70,.3)":"rgba(255,255,255,.06)")}}>
                    <div style={{fontSize:12,fontWeight:900,color:v.al?R:"rgba(255,255,255,.92)"}}>{v.val}</div>
                    <div style={{fontSize:7,color:"rgba(255,255,255,.22)",fontWeight:700,marginTop:1}}>{v.lb}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{fontSize:10,fontWeight:800,color:"rgba(255,255,255,.5)",textTransform:"uppercase",letterSpacing:"1px",marginBottom:8}}>Reading Log</div>
            {log.length===0
              ? <div style={{textAlign:"center",padding:24,color:"rgba(255,255,255,.22)",fontSize:11}}>Waiting…</div>
              : log.map(e => (
                <div key={e.id} style={{background:e.crit?"rgba(230,57,70,.06)":"#1e2a45",border:"1px solid "+(e.crit?"rgba(230,57,70,.3)":"rgba(255,255,255,.08)"),borderRadius:12,padding:"9px 11px",marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                    <span style={{fontSize:11,fontWeight:800,color:e.crit?R:"rgba(255,255,255,.92)"}}>{e.crit?"🚨":"✅"} Reading #{e.ri+1}</span>
                    <span style={{fontSize:9,color:"rgba(255,255,255,.22)",fontFamily:"monospace"}}>{e.time}</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:4}}>
                    {[["BT",e.v.BT],["HR",e.v.HR],["RR",e.v.RR],["BP",e.v.BP],["SpO₂",e.v.OSR]].map(([l,val])=>(
                      <div key={l} style={{textAlign:"center"}}>
                        <div style={{fontSize:11,fontWeight:700,fontFamily:"monospace"}}>{val}</div>
                        <div style={{fontSize:7,color:"rgba(255,255,255,.22)"}}>{l}</div>
                      </div>
                    ))}
                  </div>
                  {e.fl.map((f,i) => <div key={i} style={{fontSize:9,color:f.sev==="C"?R:Y,fontWeight:700,marginTop:3}}>⚠️ {f.msg}</div>)}
                </div>
              ))
            }
          </div>
        )}

        {/* ALERTS */}
        {tab==="A" && (
          <div className="page">
            <div style={{fontSize:13,fontWeight:800,marginBottom:4}}>🔔 Alert History</div>
            {log.filter(l=>l.fl.length>0).length===0
              ? <div style={{textAlign:"center",padding:32,color:"rgba(255,255,255,.22)"}}><div style={{fontSize:36,marginBottom:8}}>✅</div>No alerts yet</div>
              : log.filter(l=>l.fl.length>0).map(e => (
                <div key={e.id} style={{background:e.crit?"rgba(230,57,70,.07)":"rgba(244,162,97,.07)",border:"1px solid "+(e.crit?"rgba(230,57,70,.3)":"rgba(244,162,97,.2)"),borderRadius:12,padding:"11px 13px",marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                    <span style={{fontSize:11,fontWeight:800,color:e.crit?R:Y}}>{e.crit?"🚨 CRITICAL":"⚠️ WARNING"} #{e.ri+1}</span>
                    <span style={{fontSize:9,color:"rgba(255,255,255,.22)",fontFamily:"monospace"}}>{e.time}</span>
                  </div>
                  {e.fl.map((f,i) => <div key={i} style={{fontSize:10,color:"rgba(255,255,255,.75)",marginBottom:2}}>• {f.msg}</div>)}
                  <div style={{fontSize:9,fontFamily:"monospace",color:"rgba(255,255,255,.22)",marginTop:5}}>BT:{e.v.BT} HR:{e.v.HR} SpO₂:{e.v.OSR}</div>
                </div>
              ))
            }
          </div>
        )}

        {/* SOS */}
        {tab==="S" && (
          <div className="page" style={{display:"flex",flexDirection:"column",alignItems:"center",paddingTop:20}}>
            <div style={{fontSize:12,fontWeight:800,color:"rgba(255,255,255,.5)",textTransform:"uppercase",letterSpacing:"2px",marginBottom:4}}>Emergency SOS</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,.22)",marginBottom:24,textAlign:"center"}}>3-second countdown · SMS to Doctor + Emergency Contact</div>
            <div style={{position:"relative",marginBottom:20}}>
              <div style={{width:190,height:190,borderRadius:"50%",background:"rgba(230,57,70,.08)",display:"flex",alignItems:"center",justifyContent:"center",animation:sosOn?"ring 1s infinite":"none"}}>
                <button onClick={()=>setSosCd(3)} style={{width:155,height:155,borderRadius:"50%",background:R,border:"4px solid rgba(230,57,70,.3)",color:"#fff",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",boxShadow:"0 0 40px rgba(230,57,70,.4)",animation:"ring 2s infinite"}}>
                  <span style={{fontSize:36}}>🆘</span>
                  <span style={{fontSize:13,fontWeight:900,letterSpacing:"2px",marginTop:4}}>SOS</span>
                </button>
              </div>
            </div>
            {sosOn && (
              <div style={{width:"100%",background:"rgba(230,57,70,.08)",border:"1px solid rgba(230,57,70,.3)",borderRadius:18,padding:14,marginBottom:14,textAlign:"center"}}>
                <div style={{fontSize:14,fontWeight:900,color:R,marginBottom:3}}>🚨 SOS ACTIVE — SMS Sent</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.6)"}}>Doctor & Emergency contact alerted</div>
                <button onClick={()=>setSosOn(false)} style={{marginTop:10,padding:"7px 18px",background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",borderRadius:9,color:"rgba(255,255,255,.5)",fontSize:11,fontWeight:700,cursor:"pointer"}}>Cancel</button>
              </div>
            )}
            <div className="card" style={{width:"100%"}}>
              <div style={{fontSize:10,fontWeight:800,color:"rgba(255,255,255,.5)",textTransform:"uppercase",letterSpacing:"1px",marginBottom:8}}>📱 SMS Will Go To</div>
              <div style={{fontSize:11,padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,.08)",display:"flex",justifyContent:"space-between"}}>
                <span>👨‍⚕️ Doctor</span>
                <span style={{color:A,fontFamily:"monospace",fontSize:10}}>{toE164(u.doctorPhone) || "+917601010319(default)"}</span>
              </div>
              <div style={{fontSize:11,padding:"6px 0",display:"flex",justifyContent:"space-between"}}>
                <span>🆘 Emergency</span>
                <span style={{color:A,fontFamily:"monospace",fontSize:10}}>{toE164(u.ec?.[0]?.phone) || "+919573841319 (default)"}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="nav">
        {TABS.map(t => (
          <button key={t.id} className={"nb"+(tab===t.id?" on":"")} onClick={()=>setTab(t.id)} style={t.red&&tab!==t.id?{color:R}:{}}>
            <span className="ic">{t.ic}</span>
            <span className="lb">{t.lb}</span>
            {t.badge>0 && <span className="bdg">{t.badge}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── DOCTOR APP ───────────────────────────────────────────────────
function DocApp({u, logout, toast}) {
  const [tab,  setTab] = useState("T");
  const [alog, setAlog]= useState([]);
  const [dis,  setDis] = useState([]);
  const [sm,   setSm]  = useState("BiLSTM+XGBoost");

  const onRead = useCallback((nv,fl,ri) => {
    const crit = fl.some(f=>f.sev==="C");
    if (fl.length > 0) {
      toast({type:crit?"C":"W",icon:crit?"🚨":"⚠️",
        title:DB.name(1)+" — "+(crit?"CRITICAL":"Warning")+" #"+(ri+1),
        msg:fl.map(f=>f.msg).join(" · "), dur:9000});
      if (crit) {
        beep("C");
        alertCritical(DB.name(1), 1, fl, u.doctorPhone, u.ec?.[0]?.phone);
      }
      setAlog(p => [{id:Date.now(),pid:1,ri,fl,crit,
        time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}),v:nv
      },...p].slice(0,40));
    }
  }, [toast, u]);

  const lv  = useLive(20000, "1", onRead);
  const {cd}= lv;
  const all = useMemo(() => {

  const latest = DB.latest();

  // separate stable + critical patients
  const stable = latest.filter(p => !isAlarmRaised(p.AR));
  const critical = latest.filter(p => isAlarmRaised(p.AR));

  const selected = [];

  // select 3 stable patients
  selected.push(...stable.slice(0, 3));

  // select 2 critical patients
  selected.push(...critical.slice(0, 2));

  return selected;

}, []);

 
  const crit= all.filter(p=>isAlarmRaised(p.AR)).length;

  const MODELS=[
    {n:"RNN",           a:82.1,f1:.809,auc:.871,c:A},
    {n:"LSTM",          a:85.1,f1:.838,auc:.901,c:"#7209b7"},
    {n:"BiLSTM",        a:86.8,f1:.857,auc:.919,c:"#3a0ca3"},
    {n:"BiLSTM+Attn",   a:88.9,f1:.881,auc:.937,c:"#f72585"},
    {n:"BiLSTM+XGBoost",a:92.3,f1:.917,auc:.961,c:R},
  ];
  const am = MODELS.find(m=>m.n===sm)||MODELS[4];

  const TABS = [
  {id:"T", ic:"📡", lb:"Telemetry"},
  {id:"P", ic:"📅", lb:"Appointments"},   // ✅ NEW TAB
  {id:"A", ic:"🚨", lb:"Alerts", badge:alog.filter(l=>l.crit).length},
];

  return (
    <div className="shell">
      <div style={{background:"linear-gradient(135deg,#0d0d1a,#1a0a1a)",borderBottom:"1px solid rgba(255,255,255,.08)",flexShrink:0}}>
        <div style={{padding:"12px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:900,fontSize:15,color:"#fff"}}>MedAlert AI</div>
            <div style={{fontSize:8,color:"rgba(255,255,255,.35)",fontWeight:700,textTransform:"uppercase",letterSpacing:"1px",marginTop:1}}>Dr. {u.name} · {u.specialization || "General"}</div>
          </div>
          <button onClick={logout} style={{width:30,height:30,borderRadius:8,background:"rgba(255,255,255,.08)",border:"none",cursor:"pointer",color:"rgba(255,255,255,.5)",fontSize:13}}>←</button>
        </div>
        <div className="dtab">
          {TABS.map(t => (
            <button key={t.id} className={"dt"+(tab===t.id?" on":"")} onClick={()=>setTab(t.id)} style={{position:"relative"}}>
              {t.ic} {t.lb}
              {t.badge>0 && <span style={{position:"absolute",top:4,right:1,width:13,height:13,background:R,borderRadius:"50%",fontSize:7,color:"#fff",fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{t.badge}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll">
        {tab==="T" && (
          <div className="page">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <span style={{fontSize:12,fontWeight:800}}>Telemetry · <span style={{color:G}}>● LIVE</span></span>
              <span style={{fontFamily:"monospace",fontSize:12,fontWeight:900,color:cd<=2?R:cd<=5?Y:G}}>⏱ {Math.floor(cd/60)}:{String(cd%60).padStart(2,"0")}</span>
            </div>
            {all.map((p, index) => (
              <div key={p.PID} className={"card"+(p.AR?" crit":"")} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:13}}>{"Patient " + (index + 1)}</div>
                    <div style={{fontSize:10,color:p.AR?R:G,fontWeight:700,marginTop:1}}>{p.AR?"🚨 CRITICAL":"✅ Stable"}</div>
                  </div>
                  {p.AR && <span style={{fontSize:18,animation:"pulse .8s infinite"}}>🚨</span>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5}}>
                  {[["BT",p.BT,p.BT>100.5],["HR",p.HR,p.HR>100||p.HR<55],["RR",p.RR,p.RR>30],["BP",p.BP,p.BP<90||p.BP>130],["SpO₂",p.OSR,p.OSR<94]].map(([l,v,a])=>(
                    <div key={l} style={{background:"rgba(255,255,255,.04)",borderRadius:8,padding:"5px 3px",textAlign:"center",border:"1px solid "+(a?"rgba(230,57,70,.3)":"rgba(255,255,255,.05)")}}>
                      <div style={{fontSize:11,fontWeight:900,color:a?R:"rgba(255,255,255,.92)"}}>{v}</div>
                      <div style={{fontSize:7,color:"rgba(255,255,255,.22)",fontWeight:700,marginTop:1}}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* APPOINTMENTS */}
{tab==="P" && (
  <div className="page">

    <div style={{fontSize:13,fontWeight:800,marginBottom:12}}>
      📅 Patient Appointments
    </div>


    <div className="card" style={{marginBottom:12}}>
      <div style={{fontSize:12,fontWeight:800}}>
        Patient 1
      </div>

      <div style={{fontSize:11}}>
        Cardiology Review
      </div>

      <div style={{fontSize:10,color:"rgba(255,255,255,.5)"}}>
        12 April · 10:30 AM
      </div>
    </div>


    <div className="card" style={{marginBottom:12}}>
      <div style={{fontSize:12,fontWeight:800}}>
        Patient 2
      </div>

      <div style={{fontSize:11}}>
        Blood Pressure Follow-up
      </div>

      <div style={{fontSize:10,color:"rgba(255,255,255,.5)"}}>
        14 April · 02:00 PM
      </div>
    </div>


    <div className="card">
      <div style={{fontSize:12,fontWeight:800}}>
        Patient 3
      </div>

      <div style={{fontSize:11}}>
        Routine Health Check
      </div>

      <div style={{fontSize:10,color:"rgba(255,255,255,.5)"}}>
        18 April · 11:15 AM
      </div>
    </div>


  </div>
)}

        {tab==="A" && (
          <div className="page">
            <div style={{fontSize:13,fontWeight:800,marginBottom:4}}>🚨 Doctor Alert Feed</div>
            {alog.length===0
              ? <div style={{textAlign:"center",padding:32,color:"rgba(255,255,255,.22)"}}><div style={{fontSize:36,marginBottom:8}}>✅</div>Monitoring — no alerts yet</div>
              : alog.map(a => (
                <div key={a.id} style={{background:a.crit?"rgba(230,57,70,.07)":"rgba(244,162,97,.07)",border:"1px solid "+(a.crit?"rgba(230,57,70,.3)":"rgba(244,162,97,.2)"),borderRadius:12,padding:"11px 13px",marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                    <span style={{fontSize:11,fontWeight:800,color:a.crit?R:Y}}>{a.crit?"🚨 CRITICAL":"⚠️ WARNING"} · {DB.name(a.pid)} #{a.ri+1}</span>
                    <span style={{fontSize:9,color:"rgba(255,255,255,.22)",fontFamily:"monospace"}}>{a.time}</span>
                  </div>
                  {a.fl.map((f,i) => <div key={i} style={{fontSize:10,color:"rgba(255,255,255,.75)",marginBottom:2}}>• {f.msg}</div>)}
                  <div style={{fontSize:9,fontFamily:"monospace",color:"rgba(255,255,255,.22)",marginTop:4}}>BT:{a.v.BT} HR:{a.v.HR} SpO₂:{a.v.OSR}</div>
                  <button onClick={()=>setDis(p=>[...p,a.id])} style={{marginTop:5,padding:"3px 9px",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:6,color:"rgba(255,255,255,.4)",fontSize:9,fontWeight:700,cursor:"pointer"}}>ACK</button>
                </div>
              ))
            }
          </div>
        )}

        

        
      </div>

      <div className="nav">
        {TABS.map(t => (
          <button key={t.id} className={"nb"+(tab===t.id?" on":"")} onClick={()=>setTab(t.id)} style={{position:"relative"}}>
            <span className="ic">{t.ic}</span>
            <span className="lb">{t.lb}</span>
            {t.badge>0 && <span className="bdg">{t.badge}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── ROOT ─────────────────────────────────────────────────────────
// ── ROOT ─────────────────────────────────────────────────────────
function App() {

const [screen,setScreen]=useState("register");

const [user,setUser]=useState(null);

const { ts, add, rm } = useToasts();


if(screen==="register"){

return(
<>
<style>{CSS}</style>
<Toasts ts={ts} rm={rm}/>
<Auth goLogin={()=>setScreen("login")}/>
</>
);

}


if(screen==="login"){

return(
<>
<style>{CSS}</style>
<Toasts ts={ts} rm={rm}/>
<Login onLogin={(u)=>{
setUser(u);
setScreen("dashboard");
}}/>
</>
);

}


if(screen==="dashboard"){

return(
<>
<style>{CSS}</style>
<Toasts ts={ts} rm={rm}/>

{user.role==="P"
? <PatApp u={user} logout={()=>setScreen("login")} toast={add}/>
: <DocApp u={user} logout={()=>setScreen("login")} toast={add}/>
}

</>
);

}

}

// Mount React app
ReactDOM.createRoot(document.getElementById("root")).render(<App />);