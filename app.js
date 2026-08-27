let currentSlide = 0;
let currentJobIndex = 0;
let currentPresentationSlide = 0;
let currentPresentationJobIndex = 0;
let currentWorkspaceFocus = 0;
let presentationTouchStartX = null;
let presentationManifest = null;
let presentationControlsTimer = null;
let pendingApplicationJobTitle = '';
let onboardingStep = 0;
let onboardingDraft = { email: '', category: '', level: '', location: '', workType: '', interests: [] };
let rankedJobs = [];
let authMode = 'login';

const ONBOARDING_KEY = 'recruitment_user_profile_v1';
const ACCOUNTS_KEY = 'recruitment_accounts_v1';
const PERSONALIZATION_COOKIE = 'recruitment_personalization_consent';

function getCookie(name) {
  return document.cookie.split('; ').find((row) => row.startsWith(`${name}=`))?.split('=')[1] || '';
}

function setCookie(name, value, days) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${days * 86400}; Path=/; SameSite=Lax`;
}

function saveCookiePreferences(personalization, analytics) {
  const personal = typeof personalization === 'boolean' ? personalization : Boolean(document.getElementById('cookie-personalization-choice')?.checked);
  const stats = typeof analytics === 'boolean' ? analytics : Boolean(document.getElementById('cookie-analytics-choice')?.checked);
  setCookie('recruitment_cookie_consent', 'saved', 180);
  setCookie(PERSONALIZATION_COOKIE, personal ? 'accepted' : 'declined', 180);
  setCookie('recruitment_analytics_consent', stats ? 'accepted' : 'declined', 180);
  document.getElementById('cookie-banner')?.classList.remove('is-visible');
}

function toggleCookieSettings() {
  document.getElementById('cookie-options')?.classList.toggle('is-open');
}

function logUserEvent(type, job) {
  if (getCookie('recruitment_analytics_consent') !== 'accepted') return;
  let events = [];
  try { events = JSON.parse(localStorage.getItem('recruitment_job_events') || '[]'); } catch {}
  events.push({ type, jobId: job?.id || '', timestamp: new Date().toISOString() });
  localStorage.setItem('recruitment_job_events', JSON.stringify(events.slice(-100)));
}

function getUserProfile() {
  try { return JSON.parse(localStorage.getItem(ONBOARDING_KEY) || 'null'); } catch { return null; }
}
function getAccounts() { try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '{}'); } catch { return {}; } }
async function hashPassword(password) { const data = new TextEncoder().encode(password); const digest = await crypto.subtle.digest('SHA-256', data); return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join(''); }

function syncAccountUI() {
  const loggedIn = Boolean(getUserProfile());
  document.getElementById('account-actions')?.classList.toggle('is-hidden', loggedIn);
  document.getElementById('profile-open-button')?.classList.toggle('is-visible', loggedIn);
}
function openAuthModal(mode = 'login') { authMode = mode; document.getElementById('auth-modal')?.classList.add('is-open'); document.getElementById('auth-title').textContent = mode === 'login' ? 'Đăng nhập' : 'Đăng ký'; document.getElementById('auth-copy').textContent = mode === 'login' ? 'Đăng nhập để nhận đề xuất việc làm phù hợp.' : 'Tạo tài khoản để bắt đầu hành trình cá nhân hóa.'; document.getElementById('auth-switch').textContent = mode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'; }
function closeAuthModal() { document.getElementById('auth-modal')?.classList.remove('is-open'); }
function toggleAuthMode() { openAuthModal(authMode === 'login' ? 'register' : 'login'); }
async function submitAuth(event) { event.preventDefault(); const email = document.getElementById('auth-email').value.trim().toLowerCase(); const password = document.getElementById('auth-password').value; const accounts = getAccounts(); const passwordHash = await hashPassword(password); if (authMode === 'register' && accounts[email]?.passwordHash) { alert('Email này đã đăng ký. Hãy chọn Đăng nhập.'); return; } if (authMode === 'login' && accounts[email] && accounts[email].passwordHash && accounts[email].passwordHash !== passwordHash) { alert('Email hoặc mật khẩu không đúng.'); return; } if (authMode === 'login' && !accounts[email]) { alert('Tài khoản chưa tồn tại. Hãy chọn Đăng ký.'); return; } const saved = accounts[email]?.profile || {}; const alreadyCompleted = Boolean(saved.completed || saved.category || saved.interests?.length); const profile = { ...saved, email, category: saved.category || '', level: saved.level || '', location: saved.location || '', workType: saved.workType || '', interests: saved.interests || [], completed: alreadyCompleted }; accounts[email] = { profile, passwordHash, createdAt: accounts[email]?.createdAt || new Date().toISOString() }; localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); localStorage.setItem('recruitment_account_email', email); localStorage.setItem(ONBOARDING_KEY, JSON.stringify(profile)); onboardingDraft = { ...profile, interests: [...profile.interests] }; syncAccountUI(); closeAuthModal(); if (profile.completed) { alert('Đăng nhập thành công.'); return; } onboardingStep = 1; openOnboarding(); }

function scoreJob(job, profile) {
  if (!profile) return 0;
  let score = 0;
  const reasons = [];
  if (profile.category && job.category === profile.category) { score += 35; reasons.push('đúng nhóm nghề'); }
  if (profile.location && job.location.toLowerCase().includes(profile.location.toLowerCase())) { score += 20; reasons.push('phù hợp địa điểm'); }
  if (profile.workType && job.workType === profile.workType) { score += 15; reasons.push('đúng hình thức làm việc'); }
  if (profile.level && job.level === profile.level) { score += 15; reasons.push('phù hợp kinh nghiệm'); }
  const interests = profile.interests || [];
  const matched = interests.filter((item) => (job.skills || []).includes(item)).length;
  if (matched) { score += Math.min(15, matched * 5); reasons.push('khớp sở thích/kỹ năng'); }
  return { score: Math.min(100, score), reasons };
}

function rankJobsForUser() {
  const profile = getUserProfile();
  rankedJobs = [...jobsData].map((job) => ({ job, match: scoreJob(job, profile) }))
    .sort((a, b) => b.match.score - a.match.score).map((entry) => entry.job);
  return rankedJobs.length ? rankedJobs : jobsData;
}

const onboardingSteps = [
  { title: 'Bắt đầu bằng email của bạn', copy: 'Tạo hồ sơ đề xuất việc làm riêng cho bạn.', html: () => `<div class="onboarding-field"><label>Email</label><input id="onboarding-email" type="email" placeholder="ban@example.com" value="${onboardingDraft.email}" required></div>` },
  { title: 'Bạn đang quan tâm nhóm nghề nào?', copy: 'Chọn nhóm phù hợp nhất với mục tiêu hiện tại.', html: () => `<div class="onboarding-chips">${[['technology','Công nghệ'],['design','Thiết kế'],['business','Kinh doanh'],['marketing','Marketing']].map(([v,l]) => `<button type="button" class="onboarding-chip ${onboardingDraft.category===v?'is-selected':''}" data-field="category" data-value="${v}">${l}</button>`).join('')}</div>` },
  { title: 'Sở thích và kỹ năng của bạn', copy: 'Chọn một hoặc nhiều chủ đề để kết quả chính xác hơn.', html: () => `<div class="onboarding-chips">${[['javascript','JavaScript'],['frontend','Web'],['design','Thiết kế'],['3d','3D'],['autocad','AutoCAD'],['render','Render']].map(([v,l]) => `<button type="button" class="onboarding-chip ${(onboardingDraft.interests||[]).includes(v)?'is-selected':''}" data-field="interests" data-value="${v}">${l}</button>`).join('')}</div>` },
  { title: 'Thiết lập ưu tiên công việc', copy: 'Bạn có thể cập nhật các lựa chọn này sau.', html: () => `<div class="onboarding-field"><label>Kinh nghiệm</label><select id="onboarding-level"><option value="">Không giới hạn</option><option value="junior">Junior</option><option value="mid">Mid-level</option><option value="senior">Senior</option></select></div><div class="onboarding-field"><label>Địa điểm mong muốn</label><select id="onboarding-location"><option value="">Không giới hạn</option><option value="Hà Nội">Hà Nội</option><option value="TP.HCM">TP.HCM</option><option value="Remote">Remote</option></select></div><div class="onboarding-field"><label>Hình thức làm việc</label><select id="onboarding-work-type"><option value="">Không giới hạn</option><option value="hybrid">Hybrid</option><option value="onsite">Tại văn phòng</option><option value="remote">Remote</option></select></div><label class="onboarding-consent"><input id="onboarding-personalization" type="checkbox"> Tôi đồng ý lưu lựa chọn nghề nghiệp và sở thích để cá nhân hóa job.</label>` }
];

function renderOnboardingStep() {
  const step = onboardingSteps[onboardingStep];
  document.getElementById('onboarding-title').textContent = step.title;
  document.getElementById('onboarding-copy').textContent = step.copy;
  document.getElementById('onboarding-step-content').innerHTML = step.html();
  document.getElementById('onboarding-progress-bar').style.width = `${((onboardingStep + 1) / onboardingSteps.length) * 100}%`;
  document.getElementById('onboarding-back').style.visibility = onboardingStep ? 'visible' : 'hidden';
  document.getElementById('onboarding-next').textContent = onboardingStep === onboardingSteps.length - 1 ? 'Xem job phù hợp' : 'Tiếp tục';
  document.querySelectorAll('.onboarding-chip').forEach((button) => button.addEventListener('click', () => {
    const field = button.dataset.field; const value = button.dataset.value;
    if (field === 'category') onboardingDraft.category = value;
    if (field === 'interests') onboardingDraft.interests = onboardingDraft.interests.includes(value) ? onboardingDraft.interests.filter((x) => x !== value) : [...onboardingDraft.interests, value];
    renderOnboardingStep();
  }));
}

function openOnboarding() {
  const overlay = document.getElementById('onboarding-overlay'); if (!overlay) return;
  overlay.classList.add('is-open'); overlay.setAttribute('aria-hidden', 'false'); renderOnboardingStep();
}
function closeOnboarding() { document.getElementById('onboarding-overlay')?.classList.remove('is-open'); }
function openProfileSettings() {
  const modal = document.getElementById('profile-modal');
  modal?.classList.add('is-open');
  modal?.setAttribute('aria-hidden', 'false');
  modal?.style.setProperty('display', 'grid', 'important');
  const profile = getUserProfile();
  if (!profile) { modal?.classList.remove('is-open'); openAuthModal('login'); return; }
  const form = document.getElementById('profile-form');
  if (!form) return;
  form.innerHTML = `<div class="onboarding-field"><label>Email</label><input id="profile-email" type="email" value="${profile.email || ''}"></div><div class="onboarding-field"><label>Nhóm nghề</label><select id="profile-category"><option value="technology">Công nghệ</option><option value="design">Thiết kế</option><option value="business">Kinh doanh</option><option value="marketing">Marketing</option></select></div><div class="onboarding-field"><label>Địa điểm</label><select id="profile-location"><option value="">Không giới hạn</option><option value="Hà Nội">Hà Nội</option><option value="TP.HCM">TP.HCM</option><option value="Remote">Remote</option></select></div><div class="onboarding-field"><label>Hình thức làm việc</label><select id="profile-work-type"><option value="">Không giới hạn</option><option value="hybrid">Hybrid</option><option value="onsite">Tại văn phòng</option><option value="remote">Remote</option></select></div><div class="onboarding-field"><label>Kỹ năng (phân cách bằng dấu phẩy)</label><input id="profile-interests" value="${(profile.interests || []).join(', ')}"></div>`;
  ['category','location','workType'].forEach((key) => { const el = document.getElementById(`profile-${key}`); if (el) el.value = profile[key] || ''; });
}
function closeProfileSettings() { const modal = document.getElementById('profile-modal'); modal?.classList.remove('is-open'); modal?.setAttribute('aria-hidden', 'true'); modal?.style.setProperty('display', 'none', 'important'); }
function logoutUser() {
  const profile = getUserProfile(); const accounts = getAccounts(); if (profile?.email) { accounts[profile.email.toLowerCase()] = { ...(accounts[profile.email.toLowerCase()] || {}), profile }; localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); }
  localStorage.removeItem(ONBOARDING_KEY);
  localStorage.removeItem('recruitment_account_email');
  localStorage.removeItem('recruitment_job_events');
  closeProfileSettings();
  closeAuthModal();
  rankedJobs = [];
  syncAccountUI();
  alert('Bạn đã đăng xuất khỏi tài khoản.');
}
function switchAccount() {
  localStorage.removeItem(ONBOARDING_KEY);
  localStorage.removeItem('recruitment_account_email');
  closeProfileSettings();
  onboardingStep = 0;
  onboardingDraft = { email: '', category: '', level: '', location: '', workType: '', interests: [] };
  syncAccountUI();
  openOnboarding();
}
function saveProfileSettings() {
  const profile = getUserProfile() || {};
  profile.email = document.getElementById('profile-email').value.trim();
  profile.category = document.getElementById('profile-category').value;
  profile.location = document.getElementById('profile-location').value;
  profile.workType = document.getElementById('profile-work-type').value;
  profile.interests = document.getElementById('profile-interests').value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!/^\S+@\S+\.\S+$/.test(profile.email)) { alert('Email không hợp lệ.'); return; }
  localStorage.setItem(ONBOARDING_KEY, JSON.stringify(profile));
  fetch('/api/profile', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(profile) }).catch(() => {});
  rankJobsForUser(); currentPresentationJobIndex = 0; renderPresentationJobCard(); closeProfileSettings(); alert('Đã cập nhật hồ sơ và đề xuất job.');
}
function saveCurrentOnboardingFields() {
  const email = document.getElementById('onboarding-email'); if (email) onboardingDraft.email = email.value.trim();
  const level = document.getElementById('onboarding-level'); if (level) onboardingDraft.level = level.value;
  const workType = document.getElementById('onboarding-work-type'); if (workType) onboardingDraft.workType = workType.value;
  const location = document.getElementById('onboarding-location'); if (location) onboardingDraft.location = location.value;
}
function previousOnboardingStep() { saveCurrentOnboardingFields(); if (onboardingStep > 0) { onboardingStep--; renderOnboardingStep(); } }
function nextOnboardingStep() {
  saveCurrentOnboardingFields();
  if (onboardingStep === 0 && !/^\S+@\S+\.\S+$/.test(onboardingDraft.email)) { alert('Vui lòng nhập email hợp lệ.'); return; }
  if (onboardingStep < onboardingSteps.length - 1) { onboardingStep++; renderOnboardingStep(); return; }
  if (!document.getElementById('onboarding-personalization')?.checked) { alert('Vui lòng đồng ý lưu lựa chọn để cá nhân hóa job.'); return; }
  onboardingDraft.email = onboardingDraft.email || localStorage.getItem('recruitment_account_email') || '';
  onboardingDraft.completed = true;
  localStorage.setItem(ONBOARDING_KEY, JSON.stringify(onboardingDraft));
  const accounts = getAccounts();
  accounts[onboardingDraft.email.toLowerCase()] = { profile: { ...onboardingDraft }, createdAt: accounts[onboardingDraft.email.toLowerCase()]?.createdAt || new Date().toISOString() };
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  setCookie(PERSONALIZATION_COOKIE, 'accepted', 180);
  fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(onboardingDraft) }).catch(() => {});
  rankJobsForUser(); closeOnboarding(); startJourney(true);
}

const GOOGLE_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwj1cLnIFwrqfA5SiMFa3uRBztKNoO9EssCbnJJlqaWm2g9mqwPo8Sw5kd02MA96pE/exec";

const workspaceFocusData = [
  {
    label: "[Khu vực chọn vị trí ngồi & Khung cảnh 3D]",
    panel: "Khám phá toàn bộ không gian, từ ánh sáng đến bố cục mở.",
  },
  {
    label: "[Bàn làm việc cá nhân & setup tối giản]",
    panel: "Góc làm việc cá nhân giúp tăng tập trung và cảm giác sở hữu.",
  },
  {
    label: "[Khu team & khu cộng tác]",
    panel: "Không gian cộng tác dành cho workshop, brainstorm và gắn kết nhóm.",
  },
];

function updateSlidePositions() {
  const slides = document.querySelectorAll('#slider .slide');
  slides.forEach((slide, index) => {
    const offset = (index - currentSlide) * 100;
    slide.style.transform = `translateX(${offset}vw)`;
    slide.style.opacity = index === currentSlide ? '1' : '0.35';
    slide.style.zIndex = index === currentSlide ? '2' : '1';
  });
}

function nextSlide() {
  const totalSlides = document.querySelectorAll('#slider .slide').length;
  currentSlide++;
  if (currentSlide >= totalSlides) currentSlide = 0;
  updateSlidePositions();
  if (currentSlide === 3) {
    renderJobCard();
  }
}

function getPresentationSlideCount() {
  const track = document.getElementById('presentation-track');
  return track ? track.children.length : 0;
}

function buildPresentationDots() {
  const dots = document.getElementById('presentation-dots');
  if (!dots) return;

  const slideCount = getPresentationSlideCount() || 4;
  dots.innerHTML = '';
  for (let i = 0; i < slideCount; i++) {
    const dot = document.createElement('span');
    dot.className = `presentation-dot${i === currentPresentationSlide ? ' is-active' : ''}`;
    dots.appendChild(dot);
  }
}

function renderPresentationDeck(manifest) {
  const track = document.getElementById('presentation-track');
  if (!track) return;

  if (!manifest || !Array.isArray(manifest.slides) || manifest.slides.length === 0) {
    return;
  }

  const renderMode = manifest.renderMode || 'image';
  const isVideoDeck = renderMode === 'video';
  const slideCount = manifest.renderMode === 'google-slides' ? 1 : manifest.slides.length + (isVideoDeck ? 2 : 0);

  const mediaSlides = manifest.slides.map((src, index) => {
    // Ưu tiên iframe nếu manifest là deck HTML hoặc URL slide là .html.
    // Điều này giúp tương thích với manifest cũ còn thiếu renderMode.
    const isVideo = renderMode === 'video';
    const isGoogleSlides = renderMode === 'google-slides';
    const isHtmlSlide = renderMode === 'html' || /\.html(?:$|\?)/i.test(src);
    const slideContent = isVideo
      ? `<video class="journey-video journey-intro-video" src="${src}" autoplay playsinline preload="auto"></video>`
      : isGoogleSlides
      ? `<iframe class="deck-slide-frame-embed google-slides-embed" src="${src}" title="Google Slides" allowfullscreen></iframe>`
      : isHtmlSlide
        ? `<iframe class="deck-slide-frame-embed" src="${src}" title="Slide ${index + 1}" loading="eager"></iframe>`
      : `<img class="deck-slide-image" src="${src}" alt="PowerPoint slide ${index + 1}">`;

    return `
      <section class="presentation-slide">
        <div class="presentation-slide-frame">
          ${slideContent}
        </div>
      </section>
    `;
  }).join('');

  const jobSlide = isVideoDeck
    ? `
      <section class="presentation-slide presentation-jobs-slide">
        <div class="presentation-card presentation-jobs-card">
          <p class="eyebrow">Cơ hội đồng hành</p>
          <h2>Vị Trí Đang Tuyển</h2>
          <div id="presentation-job-card"></div>
        </div>
      </section>
    `
    : '';

  const jobVideoSlide = isVideoDeck
    ? `
      <section class="presentation-slide presentation-job-video-slide">
        <div class="presentation-slide-frame">
          <video class="journey-video job-description-video" src="${manifest.slides[0]}" data-default-src="${manifest.slides[0]}" playsinline preload="auto"></video>
        </div>
      </section>
    `
    : '';

  track.innerHTML = mediaSlides + jobSlide + jobVideoSlide;

  track.style.width = `${slideCount * 100}%`;
  track.querySelectorAll('.presentation-slide').forEach((slide) => {
    slide.style.flex = `0 0 ${100 / slideCount}%`;
  });

  currentPresentationSlide = 0;
  updatePresentationView();
  buildPresentationDots();

  if (renderMode === 'video') {
    const video = track.querySelector('.journey-intro-video');
    if (video) {
      video.addEventListener('ended', () => {
        if (currentPresentationSlide === 0) nextPresentationSlide();
      });
      video.play().catch(() => {});
    }
    renderPresentationJobCard();
  }
}

function playJourneyVideoWithSound(videoElement) {
  const track = document.getElementById('presentation-track');
  const video = videoElement || track?.children[currentPresentationSlide]?.querySelector('video');
  if (!video) return;

  video.muted = false;
  video.defaultMuted = false;
  video.volume = 1;
  const playRequest = video.play();

  if (playRequest?.catch) {
    playRequest.catch(() => {
      // Trình duyệt đã chặn autoplay có tiếng; vẫn giữ trải nghiệm liền mạch.
      video.muted = true;
      video.play().catch((playError) => console.warn('Video khÃ´ng thá»ƒ pháº¡t.', playError));
    });
  }
}

function playJobDescriptionVideo(job) {
  const jobVideoSlide = document.querySelector('.presentation-job-video-slide');
  const track = document.getElementById('presentation-track');
  if (!jobVideoSlide || !track) {
    openModal(job.title);
    return;
  }

  pendingApplicationJobTitle = job.title;
  currentPresentationSlide = Array.from(track.children).indexOf(jobVideoSlide);
  updatePresentationView();

  const video = jobVideoSlide.querySelector('video');
  if (!video) {
    openModal(job.title);
    return;
  }

  const targetVideoUrl = job.videoUrl || video.dataset.defaultSrc;
  if (targetVideoUrl && video.getAttribute('src') !== targetVideoUrl) {
    video.setAttribute('src', targetVideoUrl);
    video.load();
  }

  video.pause();
  video.currentTime = 0;
  // Trang nộp CV nằm ngoài presentation-shell. Vì vậy phải thoát fullscreen
  // trước khi mở form, nếu không form đã mở nhưng bị trình duyệt che đi.
  video.onended = () => {
    transitionToApplication(pendingApplicationJobTitle || job.title);
  };
  // Gọi play ngay trong click "Ứng tuyển" để trình duyệt cho phép âm thanh.
  // Nếu media chưa sẵn sàng, play() sẽ tự chờ tải dữ liệu; lần thử lại dưới
  // đây xử lý các trình duyệt đã hủy yêu cầu đầu tiên khi vừa đổi slide.
  playJourneyVideoWithSound(video);
  window.setTimeout(() => {
    if (video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      playJourneyVideoWithSound(video);
    }
  }, 450);
}

function waitForTransition(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function transitionToApplication(jobTitle) {
  const overlay = document.getElementById('presentation-overlay');
  const activeVideo = document.querySelector('.presentation-job-video-slide video');

  activeVideo?.pause();
  overlay?.classList.add('is-leaving');

  // Chỉ presentation-shell được đưa vào fullscreen; modal CV phải được mở
  // sau khi browser trả về document bình thường.
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch (error) {
      console.warn('Không thể thoát fullscreen trước khi mở form CV.', error);
    }
  }

  await waitForTransition(320);

  if (overlay) {
    overlay.classList.remove('open', 'is-leaving');
    overlay.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('presentation-active', 'video-journey-active', 'jobs-journey-active', 'presentation-controls-visible');
  window.clearTimeout(presentationControlsTimer);

  openModal(jobTitle);
  const applicationForm = document.getElementById('recruitment-form');
  applicationForm?.scrollTo({ top: 0, behavior: 'smooth' });
}

function hidePresentationControls() {
  document.body.classList.remove('presentation-controls-visible');
}

function showPresentationControlsTemporarily() {
  if (!document.body.classList.contains('video-journey-active')) return;

  document.body.classList.add('presentation-controls-visible');
  window.clearTimeout(presentationControlsTimer);
  presentationControlsTimer = window.setTimeout(hidePresentationControls, 1800);
}

async function loadPresentationManifest() {
  try {
    const response = await fetch('/api/presentation', { cache: 'no-store' });
    if (!response.ok) {
      presentationManifest = null;
      syncPresentationSourceLabel();
      return null;
    }

    presentationManifest = await response.json();
    syncPresentationSourceLabel();
    return presentationManifest;
  } catch (error) {
    console.error(error);
    presentationManifest = null;
    syncPresentationSourceLabel();
    return null;
  }
}

function updatePresentationView() {
  const track = document.getElementById('presentation-track');
  const slideCount = getPresentationSlideCount() || 1;
  if (track) {
    const step = 100 / slideCount;
    track.style.transform = `translateX(-${currentPresentationSlide * step}%)`;
  }
  buildPresentationDots();
  syncPresentationSourceLabel();
  const activeSlideHasVideo = Boolean(track?.children[currentPresentationSlide]?.querySelector('video'));
  const activeSlideIsJobs = Boolean(track?.children[currentPresentationSlide]?.classList.contains('presentation-jobs-slide'));
  document.body.classList.toggle('video-journey-active', activeSlideHasVideo);
  document.body.classList.toggle('jobs-journey-active', activeSlideIsJobs);
  if (!activeSlideHasVideo) {
    document.body.classList.remove('presentation-controls-visible');
    window.clearTimeout(presentationControlsTimer);
  }
  if (currentPresentationSlide === 1 && presentationManifest) {
    setWorkspaceFocus(currentWorkspaceFocus);
  }
  if (currentPresentationSlide === slideCount - 1) {
    renderPresentationJobCard();
  }
}

async function startJourney(fromOnboarding = false) {
  if (!fromOnboarding && !getUserProfile()) {
    openAuthModal('login');
    return;
  }
  rankJobsForUser();
  // Luôn đọc manifest mới nhất vì admin có thể upload video sau khi trang này đã mở.
  const manifest = await loadPresentationManifest();
  if (!manifest || !manifest.ready || !manifest.slides?.length) {
    alert('Bạn cần upload video ở trang admin trước khi mở Hành trình.');
    return;
  }

  const overlay = document.getElementById('presentation-overlay');
  if (!overlay) return;

  renderPresentationDeck(manifest);
  document.body.classList.add('presentation-active');
  document.body.classList.toggle('video-journey-active', manifest.renderMode === 'video');
  document.body.classList.remove('jobs-journey-active');
  document.body.classList.remove('presentation-controls-visible');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  currentPresentationSlide = 0;
  currentPresentationJobIndex = 0;
  currentWorkspaceFocus = 0;
  pendingApplicationJobTitle = '';
  renderPresentationJobCard();
  updatePresentationView();

  playJourneyVideoWithSound();

  const shell = document.querySelector('.presentation-shell');
  if (shell?.requestFullscreen) {
    shell.requestFullscreen().catch(() => {});
  }
}

async function closePresentation() {
  const overlay = document.getElementById('presentation-overlay');
  if (!overlay) return;

  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('presentation-active');
  document.body.classList.remove('video-journey-active');
  document.body.classList.remove('jobs-journey-active');
  document.body.classList.remove('presentation-controls-visible');
  window.clearTimeout(presentationControlsTimer);
  pendingApplicationJobTitle = '';

  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {}
  }
}

function nextPresentationSlide() {
  const track = document.getElementById('presentation-track');
  const activeSlide = track?.children[currentPresentationSlide];
  // Trang tuyển dụng là một điểm quyết định: chỉ nút "Ứng tuyển" mới được
  // phép mở video mô tả công việc, không cho vuốt/nút Next đi tắt qua bước này.
  if (activeSlide?.classList.contains('presentation-jobs-slide')) return;

  const slideCount = getPresentationSlideCount() || 1;
  currentPresentationSlide = (currentPresentationSlide + 1) % slideCount;
  updatePresentationView();
}

function prevPresentationSlide() {
  const track = document.getElementById('presentation-track');
  const activeSlide = track?.children[currentPresentationSlide];
  if (activeSlide?.classList.contains('presentation-jobs-slide')) return;

  const slideCount = getPresentationSlideCount() || 1;
  currentPresentationSlide = (currentPresentationSlide - 1 + slideCount) % slideCount;
  updatePresentationView();
}

function setWorkspaceFocus(index) {
  currentWorkspaceFocus = index;
  const data = workspaceFocusData[index] || workspaceFocusData[0];
  const label = document.getElementById('workspace-label');
  const copy = document.getElementById('workspace-panel-copy');
  const panel = document.getElementById('workspace-panel');
  if (label) label.textContent = data.label;
  if (copy) copy.textContent = data.panel;
  if (panel) panel.setAttribute('data-focus', String(index));

  document.querySelectorAll('.hotspot-btn').forEach((btn, btnIndex) => {
    btn.classList.toggle('is-active', btnIndex === index);
  });
}

function syncPresentationSourceLabel() {
  const label = document.getElementById('presentation-source-note');
  if (!label) return;
  if (!presentationManifest || !presentationManifest.ready) {
    label.textContent = 'Chưa có deck được upload';
    return;
  }

  label.textContent = `Deck đã upload: ${presentationManifest.sourceName}`;
}

function renderJobCard() {
  const container = document.getElementById('job-cards-container');
  if (!container) return;

  if (currentJobIndex >= jobsData.length) {
    container.innerHTML = "Bạn đã xem hết các vị trí tuyển dụng hiện tại!";
    return;
  }

  const job = jobsData[currentJobIndex];
  container.innerHTML = `
    <div class="job-card">
      <h3>${job.title}</h3>
      <p><strong>Địa điểm:</strong> ${job.location}</p>
      <p><strong>Lương:</strong> ${job.salary}</p>
      <p>${job.story}</p>
      <div class="tinder-controls">
        <button type="button" onclick="handleJobAction('skip')">Bỏ qua ✕</button>
        <button type="button" onclick="handleJobAction('follow')">Theo dõi ★</button>
        <button type="button" onclick="handleJobAction('apply')">Ứng tuyển ngay ♥</button>
      </div>
    </div>
  `;
}

function renderPresentationJobCard() {
  const container = document.getElementById('presentation-job-card');
  const availableJobs = rankedJobs.length ? rankedJobs : jobsData;
  if (!container || !availableJobs.length) return;

  const job = availableJobs[currentPresentationJobIndex % availableJobs.length];
  const match = scoreJob(job, getUserProfile());
  container.innerHTML = `
    <div class="presentation-job-title">${job.title}</div>
    <div class="presentation-job-meta"><strong>Địa điểm:</strong> ${job.location}</div>
    <div class="presentation-job-meta"><strong>Lương:</strong> ${job.salary}</div>
    <div class="presentation-job-story">${job.story}</div>
    ${match.score ? `<span class="job-match-badge">Phù hợp ${match.score}% · ${match.reasons.slice(0, 2).join(' · ')}</span>` : ''}
    <div class="presentation-actions" style="margin-top:18px;">
      <button type="button" class="btn-next" onclick="openModal('${job.title.replace(/'/g, "\\'")}')">Ứng tuyển ngay</button>
    </div>
  `;
}

function renderPresentationJobCard() {
  const container = document.getElementById('presentation-job-card');
  if (!container || !jobsData.length) return;

  const availableJobs = rankedJobs.length ? rankedJobs : jobsData;
  const job = availableJobs[currentPresentationJobIndex % availableJobs.length];
  const match = scoreJob(job, getUserProfile());
  container.innerHTML = `
    <div class="presentation-job-title">${job.title}</div>
    <div class="presentation-job-meta"><strong>Địa điểm:</strong> ${job.location}</div>
    <div class="presentation-job-meta"><strong>Lương:</strong> ${job.salary}</div>
    <div class="presentation-job-story">${job.story}</div>
    ${match.score ? `<span class="job-match-badge">Phù hợp ${match.score}% · ${match.reasons.slice(0, 2).join(' · ')}</span>` : ''}
    <div class="presentation-actions presentation-job-actions" style="margin-top:18px;">
      <button type="button" class="btn-next follow-job" onclick="handlePresentationJobAction('follow')">Theo dõi job</button>
      <button type="button" class="btn-next apply-job" onclick="handlePresentationJobAction('apply')">Ứng tuyển</button>
      <button type="button" class="btn-next skip-job" onclick="handlePresentationJobAction('skip')">Bỏ qua</button>
    </div>
  `;
}

function handlePresentationJobAction(action) {
  const availableJobs = rankedJobs.length ? rankedJobs : jobsData;
  const job = availableJobs[currentPresentationJobIndex % availableJobs.length];
  if (!job) return;
  logUserEvent(action, job);

  if (action === 'apply') {
    playJobDescriptionVideo(job);
    return;
  }

  currentPresentationJobIndex = (currentPresentationJobIndex + 1) % availableJobs.length;
  renderPresentationJobCard();
}

function nextPresentationJob() {
  const availableJobs = rankedJobs.length ? rankedJobs : jobsData;
  if (!availableJobs.length) return;
  currentPresentationJobIndex = (currentPresentationJobIndex + 1) % availableJobs.length;
  renderPresentationJobCard();
}

function prevPresentationJob() {
  const availableJobs = rankedJobs.length ? rankedJobs : jobsData;
  if (!availableJobs.length) return;
  currentPresentationJobIndex = (currentPresentationJobIndex - 1 + availableJobs.length) % availableJobs.length;
  renderPresentationJobCard();
}

function handleJobAction(action) {
  const currentJob = jobsData[currentJobIndex];
  if (!currentJob) return;

  if (action === 'apply') {
    openModal(currentJob.title);
  } else {
    console.log(`Đã ${action} vị trí: ${currentJob.title}`);
    currentJobIndex++;
    renderJobCard();
  }
}

function openModal(jobTitle) {
  document.getElementById('form-job-name').value = jobTitle;
  const modalTitle = document.getElementById('modal-job-title');
  if (modalTitle) modalTitle.innerText = `Ứng tuyển: ${jobTitle}`;
  document.getElementById('apply-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('apply-modal').style.display = 'none';
}

function openModal(jobTitle) {
  document.getElementById('form-job-name').value = jobTitle;
  const modalTitle = document.getElementById('modal-job-title');
  const modalSubtitle = document.getElementById('modal-job-subtitle');
  if (modalTitle) modalTitle.innerText = jobTitle;
  if (modalSubtitle) modalSubtitle.innerText = 'Hoàn thiện hồ sơ để nhà tuyển dụng liên hệ với bạn.';
  document.getElementById('apply-modal').style.display = 'flex';
}

// Form rút gọn: chỉ thu thập CV, địa điểm mong muốn và thư giới thiệu.
function simplifyApplicationForm() {
  const form = document.getElementById('recruitment-form');
  const firstSection = form?.querySelector('.application-section');
  if (!firstSection) return;

  firstSection.querySelector('h3')?.remove();
  ['candidate-name', 'candidate-email', 'candidate-phone'].forEach((id) => {
    document.getElementById(id)?.closest('.form-group')?.remove();
  });
}

simplifyApplicationForm();

document.getElementById('recruitment-form').addEventListener('submit', function(e) {
  e.preventDefault();
  const submitBtn = document.querySelector('#recruitment-form button[type="submit"]');
  submitBtn.innerText = "Đang tải file & gửi...";
  submitBtn.disabled = true;

  const fileInput = document.getElementById('cv-file');
  const file = fileInput.files[0];

  if (!file) {
    alert("Vui lòng chọn file CV!");
    submitBtn.disabled = false;
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const base64Data = e.target.result.split(',')[1];

    const payload = {
      job_title: document.getElementById('form-job-name').value,
      name: document.getElementById('candidate-name')?.value || '',
      email: document.getElementById('candidate-email')?.value || '',
      phone: document.getElementById('candidate-phone')?.value || '',
      preferred_location: document.getElementById('candidate-location').value,
      cover_letter: document.getElementById('candidate-cover-letter').value,
      ai_consent: document.getElementById('candidate-ai-consent').checked,
      terms_accepted: document.getElementById('candidate-terms').checked,
      fileName: file.name,
      fileMimeType: file.type,
      fileData: base64Data
    };

    fetch(GOOGLE_WEBHOOK_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    .then(() => {
      alert("Ứng tuyển thành công! File CV đã được lưu vào Google Drive và dữ liệu đã đổ về Sheet.");
      closeModal();
      submitBtn.innerText = "Gửi Hồ Sơ";
      submitBtn.disabled = false;
      document.getElementById('recruitment-form').reset();
      document.getElementById('cv-file-name').innerText = 'Chưa có file nào được chọn';
      currentJobIndex++;
      renderJobCard();
    })
    .catch(err => {
      alert("Có lỗi xảy ra khi tải file!");
      console.error(err);
      submitBtn.disabled = false;
    });
  };

  reader.readAsDataURL(file);
});

document.getElementById('cv-file').addEventListener('change', function() {
  const fileName = document.getElementById('cv-file-name');
  if (!fileName) return;
  fileName.innerText = this.files?.[0]?.name || 'Chưa có file nào được chọn';
});

function initPresentationEvents() {
  buildPresentationDots();
  updatePresentationView();

  const overlay = document.getElementById('presentation-overlay');
  const stage = document.getElementById('presentation-stage-wrap');

  if (overlay) {
    overlay.addEventListener('pointerdown', (event) => {
      presentationTouchStartX = event.clientX;
    });

    overlay.addEventListener('pointerup', (event) => {
      if (presentationTouchStartX === null) return;
      const deltaX = event.clientX - presentationTouchStartX;
      presentationTouchStartX = null;
      if (Math.abs(deltaX) < 50) return;
      if (deltaX < 0) {
        nextPresentationSlide();
      } else {
        prevPresentationSlide();
      }
    });
  }

  if (stage) {
    stage.addEventListener('pointermove', showPresentationControlsTemporarily);
    stage.addEventListener('pointerdown', showPresentationControlsTemporarily);

    stage.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
    });
  }

  document.addEventListener('keydown', (event) => {
    const overlayOpen = document.getElementById('presentation-overlay')?.classList.contains('open');
    if (!overlayOpen) return;

    if (event.key === 'ArrowRight') nextPresentationSlide();
    if (event.key === 'ArrowLeft') prevPresentationSlide();
    if (event.key === 'Escape') closePresentation();
  });
}

updateSlidePositions();
syncAccountUI();
document.getElementById('profile-open-button')?.addEventListener('click', openProfileSettings);
initPresentationEvents();
syncPresentationSourceLabel();
if (!getCookie('recruitment_cookie_consent')) {
  document.getElementById('cookie-banner')?.classList.add('is-visible');
}

// Tải trước manifest để khi người dùng bấm Hành trình, video.play() vẫn nằm
// trong ngữ cảnh thao tác click và có cơ hội autoplay kèm âm thanh.
loadPresentationManifest();
