// 연합인포맥스 기사 불러오기 (시황 일지 전용)
// type: 'close' → [채권-마감], 'pre' → [뉴욕 마켓 브리핑], 'weekly' → [채권-주간]  /  date: YYYY-MM-DD (KST)
const BASE = "https://news.einfomax.co.kr";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TYPES: Record<string, { prefix: string; hour: number; label: string }> = {
  close: { prefix: "[채권-마감]", hour: 17, label: "[채권-마감]" },
  pre: { prefix: "[뉴욕 마켓 브리핑]", hour: 8, label: "[뉴욕 마켓 브리핑]" },
  weekly: { prefix: "[채권-주간]", hour: 13, label: "[채권-주간]" },
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

async function get(url: string): Promise<string | null> {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" } });
  if (!r.ok) return null;
  return await r.text();
}
const addDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10);
};

// 해당 날짜 기사 목록의 맨 위(가장 늦게 출고된) 기사 번호
async function lastIdxOf(date: string): Promise<number | null> {
  const h = await get(`${BASE}/news/articleList.html?sc_area=A&view_type=tm&sc_sdate=${date}&sc_edate=${date}`);
  if (!h) return null;
  const total = +((h.match(/총 : <\/span>([\d,]+)/)?.[1] || "0").replace(/,/g, ""));
  const i = h.indexOf('id="section-list"');
  if (!total || i < 0) return null;
  const m = h.slice(i).match(/idxno=(\d+)/);
  return m ? +m[1] : null;
}

// 기사 출고 시각 (본문 페이지 메타태그)
async function pubTime(idx: number): Promise<string | null> {
  const h = await get(`${BASE}/news/articleView.html?idxno=${idx}`);
  return h?.match(/article:published_time" content="([^"]+)"/)?.[1] ?? null;
}

type Amp = { idx: number; title: string; date: string; html: string };
async function amp(idx: number): Promise<Amp | null> {
  const h = await get(`${BASE}/news/articleViewAmp.html?idxno=${idx}`);
  if (!h) return null;
  const title = decode(h.match(/<h1 class="amp_title">([\s\S]*?)<\/h1>/)?.[1] ?? "").trim();
  const date = h.match(/<div class="amp_info">\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
  const s = h.indexOf('id="amp_content"');
  const e = s >= 0 ? h.indexOf("</section>", s) : -1;
  if (!title || s < 0) return null;
  return { idx, title, date, html: h.slice(h.indexOf(">", s) + 1, e > 0 ? e : undefined) };
}

function decode(s: string) {
  return s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
}
function toText(html: string) {
  let h = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "").replace(/<center[\s\S]*?<\/center>/gi, "").replace(/<amp-img[\s\S]*?(<\/amp-img>|\/>)/gi, "");
  h = h.replace(/<table[\s\S]*?<\/table>/gi, (t) =>
    "\n" + t.replace(/<tr[^>]*>/gi, "\n").replace(/<br\s*\/?>/gi, " ").replace(/<\/t[dh]>/gi, "\t").replace(/<[^>]+>/g, "") + "\n");
  h = h.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h\d|li)>/gi, "\n").replace(/<[^>]+>/g, "");
  const lines = decode(h).split("\n").map((l) => l.replace(/[ \u00a0]+/g, " ").replace(/\t+$/, "").trim())
    .filter((l) => !/저작권자|무단전재/.test(l) && !/^[\w.-]+@[\w.-]+$/.test(l) && l !== "(서울=연합인포맥스)" && !(/연합인포맥스$/.test(l) && l.length < 40));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// [채권-주간]은 주말(보통 일요일) 출고 → 지정일, 하루 전, 하루 뒤 순서로 찾기
async function findWeekly(date: string) {
  for (const d of [date, addDays(date, -1), addDays(date, 1)]) {
    const r = await findOn("weekly", d);
    if (!("error" in r)) return r;
  }
  return { error: `${date} 전후 [채권-주간] 기사를 찾지 못했습니다. 아직 출고되지 않았을 수 있습니다.` };
}

async function find(type: string, date: string) {
  if (type === "weekly") return findWeekly(date);
  const cfg = TYPES[type];
  const dow = new Date(date + "T00:00:00Z").getUTCDay();
  if (dow === 0 || dow === 6) return { error: `${date}은 주말이라 ${cfg.label} 기사가 없습니다.` };
  return findOn(type, date);
}

async function findOn(type: string, date: string): Promise<{ error: string } | { title: string; url: string; date: string; text: string }> {
  const cfg = TYPES[type];
  const hi = await lastIdxOf(date);
  if (!hi) return { error: `${date}에 출고된 기사를 찾지 못했습니다.` };
  let lo: number | null = null;
  for (let k = 1; k <= 6 && !lo; k++) lo = await lastIdxOf(addDays(date, -k));
  lo = (lo ?? hi - 400) + 1;
  if (lo > hi) lo = hi - 400;

  // 목표 시각(KST) 근처 기사 번호를 이분 탐색으로 추정
  const target = `${date}T${String(cfg.hour).padStart(2, "0")}:00:00+09:00`;
  let a = lo, b = hi, center = Math.round(lo + (hi - lo) * (cfg.hour >= 12 ? 0.6 : 0.12));
  for (let it = 0; it < 7 && b - a > 24; it++) {
    const mid = Math.floor((a + b) / 2);
    let t: string | null = null, m = mid;
    for (let j = 0; j < 3 && !t; j++, m++) t = await pubTime(m);
    if (!t) break;
    if (new Date(t) < new Date(target)) a = m; else b = mid;
    center = Math.floor((a + b) / 2);
  }

  // 중심에서 바깥쪽으로 훑으며 제목·날짜 일치 기사 찾기
  const order: number[] = [center];
  for (let d = 1; order.length < hi - lo + 1; d++) {
    if (center + d <= hi) order.push(center + d);
    if (center - d >= lo) order.push(center - d);
    if (center + d > hi && center - d < lo) break;
  }
  const BATCH = 12;
  for (let i = 0; i < order.length && i < 360; i += BATCH) {
    const res = await Promise.all(order.slice(i, i + BATCH).map((n) => amp(n).catch(() => null)));
    const hit = res.find((r) => r && r.title.startsWith(cfg.prefix) && r.date === date);
    if (hit) {
      return {
        title: hit.title,
        url: `${BASE}/news/articleView.html?idxno=${hit.idx}`,
        date: hit.date,
        text: toText(hit.html),
      };
    }
  }
  return { error: `${date} ${cfg.label} 기사를 찾지 못했습니다. 휴장일이거나 아직 출고되지 않았을 수 있습니다.` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // 로그인한 사용자만 허용 (게이트웨이가 서명 검증, 여기서는 역할 확인)
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const part = tok.split(".")[1];
    let payload: { role?: string } = {};
    try { if (part) payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))); } catch { /* ignore */ }
    if (payload.role !== "authenticated") return json({ error: "로그인이 필요합니다." }, 401);

    const { type, date } = await req.json();
    if (!TYPES[type] || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return json({ error: "잘못된 요청입니다." }, 400);
    return json(await find(type, date));
  } catch (e) {
    return json({ error: "기사를 불러오는 중 오류가 발생했습니다: " + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});
