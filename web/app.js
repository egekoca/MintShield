const state = {
  jobs: [],
  filter: "all",
  language: localStorage.getItem("mintshield-language") === "en" ? "en" : "tr",
  preview: null,
  summary: null,
  signRequest: null,
  xamanStatus: "idle",
  xamanSocket: null,
  xamanConfigured: false,
};

const translations = {
  tr: {
    heroEyebrow: "Flare Smart Accounts için güvenlik katmanı",
    heroTitle: "İşlem başarısız olsa",
    heroAccent: "da FXRP güvende kalır.",
    heroBody:
      "MintShield, direct mint sonrasındaki DeFi çağrısını izole eder. Desteklenen işlem ya zincir üzerinde tamamlanır ya da FXRP aynı user operation içinde Personal Account’a geri döner.",
    planAction: "Korumalı işlemi planla",
    protectionPrinciple: "Koruma ilkesi",
    or: "veya",
    routerResidual: "Router bakiyesi",
    protectedSettlements: "Korumalı sonuçlar",
    onChain: "zincir üstü",
    exactFallbacks: "Exact fallback",
    zeroLoss: "0 kayıp",
    recoveryFlows: "Kurtarma akışları",
    proven: "kanıtlı",
    activeJobs: "Aktif işler",
    connecting: "bağlanıyor",
    now: "şimdi",
    offline: "çevrimdışı",
    reviewEyebrow: "Anladığın işlemi imzala",
    reviewTitle: "İmzadan önce her alanı gör.",
    reviewBody:
      "Bu ekran Coston2’den güncel fee ve nonce değerlerini salt-okunur olarak çeker. Seed veya private key istemez; yalnızca imzalanacak intent’in insan tarafından okunabilir ön izlemesini üretir.",
    protectedDeposit: "Korumalı deposit",
    xrplAccount: "XRPL Testnet hesabı",
    xrplAccountPlaceholder: "Xaman Testnet public adresiniz (r…)",
    xrplAccountHint: "Yalnızca public classic address; seed asla girilmez.",
    xrplTestnetHelp: "Xaman Testnet hesabı oluşturma rehberi ↗",
    protectedAmount: "Korumalı miktar",
    minimumShares: "Minimum vault share",
    executorFee: "Executor fee",
    deadline: "Son geçerlilik",
    oneHour: "1 saat",
    twoHours: "2 saat",
    sixHours: "6 saat",
    twentyFourHours: "24 saat",
    safetyNote:
      "Router yalnızca girilen exact FXRP için approve edilir. Desteklenen action post-condition’ı sağlamazsa miktar Personal Account’a döner.",
    previewAction: "Canlı intent ön izlemesi",
    previewLoading: "Coston2 okunuyor…",
    previewEmptyTitle: "İmzalanacak intent burada görünecek",
    previewEmptyBody:
      "Miktarı ve XRPL public address’i kontrol edip ön izleme oluştur. Hiçbir işlem gönderilmez.",
    comparisonTitle: "Aynı hata, iki farklı sonuç",
    comparisonBody:
      "Desteklenen action revert ettiğinde MintShield outer operation’ı başarıyla kapatır. Çıplak akışta ise ikinci ödeme ve kurtarma gerekir.",
    mintshieldProtected: "MintShield korumalı",
    oneSignature: "Tek XRPL imzası",
    xrplVerified: "XRPL payment doğrulandı",
    fxrpMinted: "FXRP mint edildi",
    vaultReverted: "Vault çağrısı revert etti",
    fxrpReturned: "Exact FXRP Personal Account’a döndü",
    userOutcome: "Kullanıcı sonucu",
    fxrpRefunded: "1.000000 FXRP iade",
    withoutRouter: "Router olmadan",
    userOpReverted: "User operation revert etti",
    secondPayment: "İkinci XRPL payment + 0xE0",
    proofRetried: "Orijinal proof yeniden çalıştırıldı",
    extraTransactions: "3 ek zincir işlemi",
    liveRecords: "Canlı işlem kayıtları",
    all: "Tümü",
    transaction: "İşlem",
    status: "Durum",
    updated: "Güncelleme",
    loadingRecords: "Executor kayıtları yükleniyor…",
    customInstruction: "0xFE talimatı",
    paymentAttestation: "Ödeme kanıtı",
    smartAccountExecution: "Smart Account yürütmesi",
    successOrReturn: "Başarı veya exact iade",
    footerNotice: "Testnet prototipi. Bağımsız audit tamamlanmamıştır.",
    transactionDetail: "İşlem detayı",
    copied: "Kopyalandı ✓",
    humanReview: "İnsan tarafından okunabilir inceleme",
    commitmentReady: "COMMITMENT HAZIR",
    totalXrplPayment: "XRPL’de gönderilecek toplam",
    expectedNet: "Beklenen net",
    routerLimit: "Router harcama limiti",
    minimumOutput: "Minimum çıktı",
    adapter: "Adapter",
    fallbackReceiver: "Fallback receiver",
    memo: "Memo",
    copyHash: "Hash’i kopyala",
    previewReadOnly:
      "Ön izleme salt-okunurdur. Devam ettiğinde işlem seed paylaşmadan Xaman içinde yeniden incelenip imzalanır.",
    previewFailed: "Ön izleme oluşturulamadı",
    emptyFilter: "Bu filtrede işlem bulunamadı.",
    bareRecovery: "Bare recovery",
    protectedJob: "Protected deposit",
    fdcWaiting: "FDC bekleniyor",
    yes: "Evet",
    no: "Hayır",
    verifiedValues: "Doğrulanmış değerler",
    executorNote: "Executor notu",
    jobsUnavailable: "Executor kayıtları alınamadı.",
    statusApiUnavailable: "Status API bağlantısı kurulamadı",
    signWithXaman: "Xaman ile güvenli imzala",
    xamanCreating: "Xaman isteği hazırlanıyor…",
    xamanTitle: "Xaman imza isteği",
    scanQr: "Xaman uygulamasıyla QR kodu tara veya mobil cihazda bağlantıyı aç.",
    openXaman: "Xaman’da aç",
    waitingForWallet: "Cüzdanın isteği açması bekleniyor",
    openedWallet: "İstek Xaman’da açıldı",
    statusChecking: "İmza sonucu doğrulanıyor…",
    signedVerified: "İmza ve Testnet işlemi doğrulandı",
    signedRejected: "İmza isteği reddedildi veya süresi doldu",
    signedMismatch: "İmza doğrulama kontrolleri başarısız",
    checkStatus: "Durumu doğrula",
    xamanTestnetNote:
      "Xaman’da XRPL Testnet’i ve yukarıdaki aynı public hesabı seç. Seed veya secret girme.",
    qrAlt: "MintShield Xaman imza QR kodu",
    xamanCreateFailed: "Xaman imza isteği oluşturulamadı",
    xamanUnavailable: "Xaman güvenli etkinleştirme bekliyor",
  },
  en: {
    heroEyebrow: "Safety layer for Flare Smart Accounts",
    heroTitle: "Even when an action fails,",
    heroAccent: "your FXRP stays protected.",
    heroBody:
      "MintShield isolates the DeFi call after a direct mint. A supported action either completes on-chain or returns the FXRP to the Personal Account within the same user operation.",
    planAction: "Plan a protected action",
    protectionPrinciple: "Protection principle",
    or: "or",
    routerResidual: "Router residual",
    protectedSettlements: "Protected settlements",
    onChain: "on-chain",
    exactFallbacks: "Exact fallbacks",
    zeroLoss: "0 loss",
    recoveryFlows: "Recovery flows",
    proven: "proven",
    activeJobs: "Active jobs",
    connecting: "connecting",
    now: "now",
    offline: "offline",
    reviewEyebrow: "Sign what you understand",
    reviewTitle: "Review every field before signing.",
    reviewBody:
      "This screen reads the current fee and nonce from Coston2. It never asks for a seed or private key; it only creates a human-readable preview of the intent to be signed.",
    protectedDeposit: "Protected deposit",
    xrplAccount: "XRPL Testnet account",
    xrplAccountPlaceholder: "Your Xaman Testnet public address (r…)",
    xrplAccountHint: "Public classic address only; never enter a seed.",
    xrplTestnetHelp: "How to create a Xaman Testnet account ↗",
    protectedAmount: "Protected amount",
    minimumShares: "Minimum vault shares",
    executorFee: "Executor fee",
    deadline: "Deadline",
    oneHour: "1 hour",
    twoHours: "2 hours",
    sixHours: "6 hours",
    twentyFourHours: "24 hours",
    safetyNote:
      "The Router receives approval for the exact FXRP input only. If the supported action fails its post-condition, the amount returns to the Personal Account.",
    previewAction: "Create live intent preview",
    previewLoading: "Reading Coston2…",
    previewEmptyTitle: "The intent to sign will appear here",
    previewEmptyBody:
      "Review the amount and XRPL public address, then create a preview. No transaction is submitted.",
    comparisonTitle: "The same failure, two different outcomes",
    comparisonBody:
      "When a supported action reverts, MintShield closes the outer operation successfully. The bare flow requires a second payment and recovery.",
    mintshieldProtected: "Protected by MintShield",
    oneSignature: "One XRPL signature",
    xrplVerified: "XRPL payment verified",
    fxrpMinted: "FXRP minted",
    vaultReverted: "Vault call reverted",
    fxrpReturned: "Exact FXRP returned to Personal Account",
    userOutcome: "User outcome",
    fxrpRefunded: "1.000000 FXRP returned",
    withoutRouter: "Without the Router",
    userOpReverted: "User operation reverted",
    secondPayment: "Second XRPL payment + 0xE0",
    proofRetried: "Original proof submitted again",
    extraTransactions: "3 additional chain transactions",
    liveRecords: "Live transaction records",
    all: "All",
    transaction: "Transaction",
    status: "Status",
    updated: "Updated",
    loadingRecords: "Loading executor records…",
    customInstruction: "0xFE instruction",
    paymentAttestation: "Payment attestation",
    smartAccountExecution: "Smart Account execution",
    successOrReturn: "Success or exact return",
    footerNotice: "Testnet prototype. An independent audit has not been completed.",
    transactionDetail: "Transaction details",
    copied: "Copied ✓",
    humanReview: "Human-readable review",
    commitmentReady: "COMMITMENT READY",
    totalXrplPayment: "Total to send on XRPL",
    expectedNet: "Expected net",
    routerLimit: "Router spending limit",
    minimumOutput: "Minimum output",
    adapter: "Adapter",
    fallbackReceiver: "Fallback receiver",
    memo: "Memo",
    copyHash: "Copy hash",
    previewReadOnly:
      "The preview is read-only. If you continue, the transaction is reviewed and signed again inside Xaman without sharing a seed.",
    previewFailed: "Could not create preview",
    emptyFilter: "No transactions match this filter.",
    bareRecovery: "Bare recovery",
    protectedJob: "Protected deposit",
    fdcWaiting: "Waiting for FDC",
    yes: "Yes",
    no: "No",
    verifiedValues: "Verified values",
    executorNote: "Executor note",
    jobsUnavailable: "Executor records could not be loaded.",
    statusApiUnavailable: "Could not connect to Status API",
    signWithXaman: "Sign securely with Xaman",
    xamanCreating: "Creating Xaman request…",
    xamanTitle: "Xaman signing request",
    scanQr: "Scan the QR code with Xaman or open the link on your mobile device.",
    openXaman: "Open in Xaman",
    waitingForWallet: "Waiting for the wallet to open the request",
    openedWallet: "Request opened in Xaman",
    statusChecking: "Verifying signing result…",
    signedVerified: "Signature and Testnet transaction verified",
    signedRejected: "Signing request rejected or expired",
    signedMismatch: "Signing verification checks failed",
    checkStatus: "Verify status",
    xamanTestnetNote:
      "Select XRPL Testnet and the same public account shown above in Xaman. Never enter a seed or secret.",
    qrAlt: "MintShield Xaman signing QR code",
    xamanCreateFailed: "Could not create Xaman signing request",
    xamanUnavailable: "Xaman awaits secure activation",
  },
};

const statusLabels = {
  tr: {
    CREATED: "Oluşturuldu",
    XRPL_SIGNED: "XRPL imzalandı",
    XRPL_FINALIZED: "XRPL kesinleşti",
    FDC_REQUESTED: "FDC istendi",
    PROOF_READY: "Proof hazır",
    FLARE_SUBMITTED: "Flare gönderildi",
    DELAYED: "Mint gecikmeli",
    SETTLED_SUCCESS: "Başarılı",
    SETTLED_FALLBACK: "Exact fallback",
    RECOVERY_REQUIRED: "Recovery gerekli",
    RECOVERY_PAYMENT_SIGNED: "Recovery imzalandı",
    RECOVERY_PAYMENT_FINALIZED: "Recovery kesinleşti",
    RECOVERY_FDC_REQUESTED: "Recovery FDC",
    RECOVERY_PROOF_READY: "Recovery proof hazır",
    RECOVERY_FLAG_SUBMITTED: "0xE0 gönderildi",
    RECOVERY_FLAG_SET: "IgnoreMemoSet",
    RECOVERY_STUCK_SUBMITTED: "Proof yeniden gönderildi",
    RECOVERED: "Kurtarıldı",
    FAILED: "Başarısız",
  },
  en: {
    CREATED: "Created",
    XRPL_SIGNED: "XRPL signed",
    XRPL_FINALIZED: "XRPL finalized",
    FDC_REQUESTED: "FDC requested",
    PROOF_READY: "Proof ready",
    FLARE_SUBMITTED: "Submitted to Flare",
    DELAYED: "Mint delayed",
    SETTLED_SUCCESS: "Successful",
    SETTLED_FALLBACK: "Exact fallback",
    RECOVERY_REQUIRED: "Recovery required",
    RECOVERY_PAYMENT_SIGNED: "Recovery signed",
    RECOVERY_PAYMENT_FINALIZED: "Recovery finalized",
    RECOVERY_FDC_REQUESTED: "Recovery FDC",
    RECOVERY_PROOF_READY: "Recovery proof ready",
    RECOVERY_FLAG_SUBMITTED: "0xE0 submitted",
    RECOVERY_FLAG_SET: "IgnoreMemoSet",
    RECOVERY_STUCK_SUBMITTED: "Proof resubmitted",
    RECOVERED: "Recovered",
    FAILED: "Failed",
  },
};

const detailLabels = {
  tr: {
    personalAccount: "Personal Account",
    nonce: "Smart Account nonce",
    paymentAmountDrops: "XRPL payment (drops)",
    amountIn: "Router input",
    amountOut: "Adapter output",
    returnedAmount: "İade edilen FXRP",
    failureCode: "Failure code",
    recoveryAmount: "Recovery mint",
    recoveryExecutorFee: "Recovery executor fee",
    recoveredStuckAmount: "Kurtarılan original mint",
    stuckRetryExecutorFee: "Original executor fee",
    delayKind: "Gecikme türü",
    xrplLedgerIndex: "XRPL ledger",
    xrplConfirmations: "XRPL confirmations",
    jobKind: "İş türü",
  },
  en: {
    personalAccount: "Personal Account",
    nonce: "Smart Account nonce",
    paymentAmountDrops: "XRPL payment (drops)",
    amountIn: "Router input",
    amountOut: "Adapter output",
    returnedAmount: "Returned FXRP",
    failureCode: "Failure code",
    recoveryAmount: "Recovery mint",
    recoveryExecutorFee: "Recovery executor fee",
    recoveredStuckAmount: "Recovered original mint",
    stuckRetryExecutorFee: "Original executor fee",
    delayKind: "Delay type",
    xrplLedgerIndex: "XRPL ledger",
    xrplConfirmations: "XRPL confirmations",
    jobKind: "Job type",
  },
};

const $ = (selector) => document.querySelector(selector);
const t = (key) => translations[state.language][key] ?? key;
const statusLabel = (status) =>
  statusLabels[state.language][status] ?? status;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shortHash(value, left = 7, right = 5) {
  if (!value || value.length <= left + right + 1) return value || "—";
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat(state.language === "tr" ? "tr-TR" : "en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(status) {
  if (["SETTLED_SUCCESS", "SETTLED_FALLBACK", "RECOVERED"].includes(status)) {
    return "success";
  }
  if (["FAILED", "RECOVERY_REQUIRED"].includes(status)) return "danger";
  if (status === "DELAYED") return "warning";
  return "progress";
}

function copyText(value, button) {
  navigator.clipboard.writeText(value).then(() => {
    const previous = button.textContent;
    button.textContent = t("copied");
    setTimeout(() => {
      button.textContent = previous;
    }, 1_500);
  });
}

function previewField(label, value, mono = false) {
  const item = el("div", "preview-field");
  item.append(
    el("span", "", label),
    el("strong", mono ? "mono" : "", value),
  );
  return item;
}

function renderPreview(preview) {
  state.preview = preview;
  const panel = $("#preview-panel");
  panel.replaceChildren();

  const head = el("div", "preview-head");
  const title = el("div");
  title.append(
    el("span", "step-number", "02"),
    el("strong", "", t("humanReview")),
  );
  head.append(title, el("span", "preview-ready", t("commitmentReady")));
  panel.append(head);

  const payment = el("div", "payment-total");
  payment.append(
    el("span", "", t("totalXrplPayment")),
    el("strong", "", `${preview.quote.paymentAmountXrp} XRP`),
    el(
      "small",
      "",
      `${preview.quote.mintingFeeFxrp} FXRP protocol fee · ${preview.quote.executorFeeFxrp} FXRP executor fee`,
    ),
  );
  panel.append(payment);

  const route = el("div", "preview-route");
  route.append(
    previewField(t("expectedNet"), `${preview.quote.expectedPersonalAccountFxrp} FXRP`),
    el("i", "", "→"),
    previewField(t("routerLimit"), `${preview.intent.inputAmountFxrp} FXRP`),
    el("i", "", "→"),
    previewField(t("minimumOutput"), `${preview.intent.minimumShares} msSHARE`),
  );
  panel.append(route);

  const grid = el("div", "preview-details");
  grid.append(
    previewField("Personal Account", shortHash(preview.intent.personalAccount, 10, 8), true),
    previewField("Smart Account nonce", preview.intent.nonce, true),
    previewField(t("adapter"), `ERC-4626 · v${preview.intent.adapterVersion}`),
    previewField(t("fallbackReceiver"), shortHash(preview.intent.fallbackReceiver, 10, 8), true),
    previewField(t("deadline"), formatTime(preview.intent.deadlineIso)),
    previewField(t("memo"), `${preview.commitment.memoBytes} ${state.language === "tr" ? "bayt" : "bytes"} · 0xFE`, true),
  );
  panel.append(grid);

  const commitment = el("div", "commitment-box");
  commitment.append(
    el("span", "", "USER OPERATION HASH"),
    el("code", "", preview.commitment.userOpHash),
  );
  const copy = el("button", "", t("copyHash"));
  copy.type = "button";
  copy.addEventListener("click", () =>
    copyText(preview.commitment.userOpHash, copy),
  );
  commitment.append(copy);
  panel.append(commitment);

  if (preview.warnings.length) {
    const warnings = el("ul", "preview-warnings");
    for (const warning of preview.warnings) {
      const translated =
        state.language === "tr" &&
        warning === "Testnet only. Review every field again in the external wallet."
          ? "Yalnızca testnet. Her alanı dış cüzdanda tekrar kontrol et."
          : state.language === "tr" &&
              warning.startsWith("Payment exceeds")
            ? "Ödeme güncel large-mint eşiğini aşıyor ve gecikebilir."
            : warning;
      warnings.append(el("li", "", translated));
    }
    panel.append(warnings);
  }

  const next = el("div", "signing-next");
  next.append(
    el("span", "", "✓"),
    el(
      "p",
      "",
      t("previewReadOnly"),
    ),
  );
  panel.append(next);

  const signButton = el("button", "button xaman-action");
  signButton.type = "button";
  signButton.disabled = !state.xamanConfigured;
  signButton.title = state.xamanConfigured ? "" : t("xamanUnavailable");
  signButton.append(
    el("span", "xaman-mark", "X"),
    el(
      "span",
      "",
      state.xamanConfigured ? t("signWithXaman") : t("xamanUnavailable"),
    ),
    el("span", "", "↗"),
  );
  signButton.addEventListener("click", () => createXamanRequest(signButton));
  panel.append(signButton);

  if (state.signRequest !== null) renderXamanPanel();
}

function renderPreviewError(message) {
  const panel = $("#preview-panel");
  panel.replaceChildren();
  const error = el("div", "preview-empty preview-error");
  error.append(
    el("span", "preview-shield", "!"),
    el("strong", "", t("previewFailed")),
    el("p", "", message),
  );
  panel.append(error);
}

function previewFormBody() {
  const form = new FormData($("#preview-form"));
  return {
    xrplAddress: form.get("xrplAddress"),
    amountFxrp: form.get("amountFxrp"),
    minimumShares: form.get("minimumShares"),
    executorFeeFxrp: form.get("executorFeeFxrp"),
    deadlineMinutes: Number(form.get("deadlineMinutes")),
  };
}

function xamanStatusCopy() {
  if (state.xamanStatus === "opened") return t("openedWallet");
  if (state.xamanStatus === "checking") return t("statusChecking");
  if (state.xamanStatus === "verified") return t("signedVerified");
  if (state.xamanStatus === "rejected") return t("signedRejected");
  if (state.xamanStatus === "mismatch") return t("signedMismatch");
  return t("waitingForWallet");
}

function renderXamanPanel() {
  const existing = $("#xaman-signing");
  if (existing !== null) existing.remove();
  if (state.signRequest === null) return;

  const signing = el("section", "xaman-signing");
  signing.id = "xaman-signing";
  const copy = el("div", "xaman-copy");
  copy.append(
    el("span", "xaman-kicker", "XAMAN · XRPL TESTNET"),
    el("h3", "", t("xamanTitle")),
    el("p", "", t("scanQr")),
  );

  const qr = el("img", "xaman-qr");
  qr.src = state.signRequest.qrPng;
  qr.alt = t("qrAlt");
  qr.referrerPolicy = "no-referrer";

  const actions = el("div", "xaman-links");
  const deepLink = el("a", "button xaman-open");
  deepLink.href = state.signRequest.deepLink;
  deepLink.target = "_blank";
  deepLink.rel = "noreferrer";
  deepLink.append(
    document.createTextNode(t("openXaman")),
    el("span", "", "↗"),
  );
  const check = el("button", "xaman-check", t("checkStatus"));
  check.type = "button";
  check.addEventListener("click", () =>
    verifyXamanStatus(state.signRequest.uuid),
  );
  actions.append(deepLink, check);

  const status = el(
    "div",
    `xaman-status xaman-status-${state.xamanStatus}`,
  );
  status.id = "xaman-status";
  status.append(el("i"), el("span", "", xamanStatusCopy()));

  const note = el("p", "xaman-note", t("xamanTestnetNote"));
  const content = el("div", "xaman-content");
  content.append(copy, actions, status, note);
  signing.append(qr, content);
  $("#preview-panel").append(signing);
}

async function verifyXamanStatus(uuid) {
  state.xamanStatus = "checking";
  renderXamanPanel();
  try {
    const response = await fetch(
      `/api/xaman/sign-request/${encodeURIComponent(uuid)}`,
      { headers: { Accept: "application/json" } },
    );
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `Xaman status ${response.status}`);
    }
    const result = payload.signRequest;
    if (result.resolved && result.signed) {
      state.xamanStatus = Object.values(result.checks).every(Boolean)
        ? "verified"
        : "mismatch";
    } else if (result.cancelled || result.expired || result.resolved) {
      state.xamanStatus = "rejected";
    } else if (result.opened) {
      state.xamanStatus = "opened";
    } else {
      state.xamanStatus = "waiting";
    }
    renderXamanPanel();
    if (payload.job !== undefined) loadJobs();
  } catch (cause) {
    state.xamanStatus = "mismatch";
    renderXamanPanel();
    console.error("Xaman status verification failed", cause);
  }
}

function watchXamanStatus(signRequest) {
  if (state.xamanSocket !== null) state.xamanSocket.close();
  const socket = new WebSocket(signRequest.websocketStatus);
  state.xamanSocket = socket;
  socket.addEventListener("message", (event) => {
    try {
      const update = JSON.parse(event.data);
      if (update.opened === true) {
        state.xamanStatus = "opened";
        renderXamanPanel();
      }
      if (
        typeof update.signed === "boolean" ||
        update.expired === true
      ) {
        socket.close();
        verifyXamanStatus(signRequest.uuid);
      }
    } catch {
      // Keepalive or non-JSON messages do not change authoritative state.
    }
  });
}

async function createXamanRequest(button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = t("xamanCreating");
  try {
    const response = await fetch("/api/xaman/sign-request", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(previewFormBody()),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `Xaman API ${response.status}`);
    }
    state.signRequest = payload.signRequest;
    state.xamanStatus = "waiting";
    renderPreview(payload.preview);
    watchXamanStatus(payload.signRequest);
  } catch (cause) {
    renderPreviewError(`${t("xamanCreateFailed")}: ${cause.message}`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

$("#preview-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#preview-submit");
  const buttonLabel = button.querySelector("[data-i18n='previewAction']");
  button.disabled = true;
  buttonLabel.textContent = t("previewLoading");
  try {
    const response = await fetch("/api/preview", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(previewFormBody()),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `Preview API ${response.status}`);
    }
    if (state.xamanSocket !== null) state.xamanSocket.close();
    state.signRequest = null;
    state.xamanStatus = "idle";
    renderPreview(payload.preview);
  } catch (cause) {
    renderPreviewError(cause.message);
  } finally {
    button.disabled = false;
    buttonLabel.textContent = t("previewAction");
  }
});

function isRecovery(job) {
  return (
    job.status.startsWith("RECOVERY") ||
    job.status === "RECOVERED" ||
    job.details.jobKind === "bare-comparison"
  );
}

function updateMetrics(summary) {
  const success = state.jobs.filter((job) =>
    ["SETTLED_SUCCESS", "SETTLED_FALLBACK"].includes(job.status),
  ).length;
  const fallback = state.jobs.filter(
    (job) => job.status === "SETTLED_FALLBACK",
  ).length;
  const recovery = state.jobs.filter((job) => job.status === "RECOVERED").length;
  $("#settled-count").textContent = String(success);
  $("#fallback-count").textContent = String(fallback);
  $("#recovery-count").textContent = String(recovery);
  $("#active-count").textContent = String(summary.active);
  $("#sync-label").textContent = t("now");
}

function appendExternalLink(parent, label, href) {
  if (!href) return;
  const link = el("a", "evidence-link");
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = `${label} ↗`;
  parent.append(link);
}

function renderJobs() {
  const list = $("#jobs-list");
  list.replaceChildren();
  const visible = state.jobs.filter((job) => {
    if (state.filter === "recovery") return isRecovery(job);
    if (state.filter === "protected") return !isRecovery(job);
    return true;
  });

  if (visible.length === 0) {
    list.append(el("div", "empty-row", t("emptyFilter")));
    return;
  }

  for (const job of visible) {
    const row = el("button", "job-row");
    row.type = "button";
    row.addEventListener("click", () => showJob(job));

    const identity = el("span", "job-identity");
    identity.append(
      el("i", `job-kind ${isRecovery(job) ? "recovery" : "protected"}`, isRecovery(job) ? "R" : "M"),
    );
    const identityCopy = el("span");
    identityCopy.append(
      el("strong", "", isRecovery(job) ? t("bareRecovery") : t("protectedJob")),
      el("small", "mono", shortHash(job.id, 8, 5)),
    );
    identity.append(identityCopy);

    const status = el("span", `status status-${statusTone(job.status)}`);
    status.append(el("i"), document.createTextNode(statusLabel(job.status)));

    const proof = el("span", "proof-cell");
    proof.append(
      el("strong", "mono", shortHash(job.xrplTxHash)),
      el("small", "", job.votingRound ? `FDC round ${job.votingRound}` : t("fdcWaiting")),
    );

    const updated = el("span", "updated-cell");
    updated.append(
      el("strong", "", formatTime(job.updatedAt)),
      el("small", "", "Coston2 testnet"),
    );

    row.append(
      identity,
      status,
      proof,
      updated,
      el("span", "row-arrow", "→"),
    );
    list.append(row);
  }
}

function detailValue(key, value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? t("yes") : t("no");
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  if (text.startsWith("0x") && text.length > 42) return shortHash(text, 12, 8);
  return text;
}

function showJob(job) {
  const body = $("#dialog-body");
  body.replaceChildren();

  const summary = el("div", "dialog-summary");
  const status = el("span", `status status-${statusTone(job.status)}`);
  status.append(el("i"), document.createTextNode(statusLabel(job.status)));
  summary.append(
    el("span", "dialog-kind", isRecovery(job) ? "BARE / RECOVERY" : "MINTSHIELD PROTECTED"),
    status,
  );
  body.append(summary);

  const timeline = el("ol", "timeline");
  for (const step of job.timeline) {
    const item = el("li", `timeline-${step.state}`);
    item.append(
      el("i", "", step.state === "completed" ? "✓" : step.state === "attention" ? "!" : ""),
      el("span", "", statusLabel(step.status)),
    );
    timeline.append(item);
  }
  body.append(timeline);

  const links = el("div", "evidence-links");
  appendExternalLink(links, "XRPL Explorer", job.links.xrpl);
  appendExternalLink(links, "FDC Round", job.links.fdc);
  appendExternalLink(links, "Flare Explorer", job.links.flare);
  if (links.childElementCount) body.append(links);

  const details = Object.entries(job.details).filter(
    ([key]) => detailLabels[state.language][key] !== undefined,
  );
  if (details.length) {
    body.append(el("h3", "detail-heading", t("verifiedValues")));
    const grid = el("dl", "details-grid");
    for (const [key, value] of details) {
      const cell = el("div");
      cell.append(
        el("dt", "", detailLabels[state.language][key]),
        el("dd", value?.toString().startsWith("0x") ? "mono" : "", detailValue(key, value)),
      );
      grid.append(cell);
    }
    body.append(grid);
  }

  if (job.lastError && !["RECOVERED", "SETTLED_FALLBACK"].includes(job.status)) {
    const error = el("div", "job-error");
    error.append(el("strong", "", t("executorNote")), el("p", "", job.lastError));
    body.append(error);
  }

  $("#job-dialog").showModal();
}

async function loadJobs() {
  const error = $("#error-message");
  try {
    const response = await fetch("/api/jobs", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const payload = await response.json();
    state.jobs = payload.jobs.sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
    );
    state.summary = payload.summary;
    updateMetrics(payload.summary);
    renderJobs();
    error.hidden = true;
  } catch (cause) {
    $("#sync-label").textContent = t("offline");
    $("#jobs-list").replaceChildren(
      el("div", "empty-row", t("jobsUnavailable")),
    );
    error.textContent = `${t("statusApiUnavailable")}: ${cause.message}`;
    error.hidden = false;
  }
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const payload = await response.json();
    state.xamanConfigured = payload.xamanConfigured === true;
  } catch {
    state.xamanConfigured = false;
  }
  if (state.preview !== null) renderPreview(state.preview);
}

function applyLanguage(language) {
  state.language = language === "en" ? "en" : "tr";
  localStorage.setItem("mintshield-language", state.language);
  document.documentElement.lang = state.language;
  document.title =
    state.language === "tr"
      ? "MintShield · Korumalı FXRP İşlemleri"
      : "MintShield · Protected FXRP Execution";
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const button of document.querySelectorAll(".language-option")) {
    const active = button.dataset.lang === state.language;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  $("#dialog-close").setAttribute(
    "aria-label",
    state.language === "tr" ? "Kapat" : "Close",
  );
  if (state.summary !== null) updateMetrics(state.summary);
  if (state.jobs.length > 0) renderJobs();
  if (state.preview !== null) renderPreview(state.preview);
}

for (const button of document.querySelectorAll(".language-option")) {
  button.addEventListener("click", () => applyLanguage(button.dataset.lang));
}

for (const button of document.querySelectorAll(".filter")) {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    renderJobs();
  });
}

$("#dialog-close").addEventListener("click", () => $("#job-dialog").close());
$("#job-dialog").addEventListener("click", (event) => {
  if (event.target === $("#job-dialog")) $("#job-dialog").close();
});

applyLanguage(state.language);
loadHealth();
loadJobs();
setInterval(loadJobs, 30_000);
