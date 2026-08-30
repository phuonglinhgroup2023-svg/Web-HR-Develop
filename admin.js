let latestReport = null;
let adminAuthMode = 'login';

const actionLabels = { view: 'Xem', like: 'Thích', skip: 'Bỏ qua', follow: 'Theo dõi', apply: 'Ứng tuyển' };
const videoSlotLabels = { intro: 'Video giới thiệu không gian công ty', 'job-default': 'Video mô tả job mặc định', 'job-01': 'Job 01 - Lập trình Web', 'job-02': 'Job 02 - Nội thất 3D' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

async function refreshAdminState() {
  const status = document.getElementById('admin-status');
  try {
    const [reportResponse, presentationResponse] = await Promise.all([fetch('/api/admin/overview', { cache: 'no-store' }), fetch('/api/presentation', { cache: 'no-store' })]);
    if (reportResponse.status === 401) { showAdminAuth(); return; }
    if (!reportResponse.ok) throw new Error('Không thể tải báo cáo');
    latestReport = await reportResponse.json();
    renderReport(latestReport);
    if (presentationResponse.ok) {
      const manifest = await presentationResponse.json();
      document.getElementById('admin-preview-item').textContent = `Đang dùng: ${manifest.sourceName} • ${manifest.slideCount} video`;
      renderVideoList(manifest.videos || {});
    } else document.getElementById('admin-preview-item').textContent = 'Chưa có video.';
    if (status) status.textContent = `Cập nhật ${new Date().toLocaleTimeString('vi-VN')}`;
  } catch (error) {
    if (status) status.textContent = error.message;
    console.error(error);
  }
}

function renderVideoList(videos) {
  const list = document.getElementById('admin-video-list');
  if (!list) return;
  const entries = Object.values(videos);
  list.innerHTML = entries.length ? `<h3>Video đã gắn vào từng mục</h3>${entries.map((video) => `<div class="admin-video-item"><span><strong>${escapeHtml(videoSlotLabels[video.slot] || video.slot)}</strong><small>${escapeHtml(video.sourceName || '')}</small></span><a href="${video.videoUrl}" target="_blank" rel="noreferrer">Xem video</a></div>`).join('')}` : '<p class="admin-note">Chưa có video nào được gắn vào mục.</p>';
}

function showAdminAuth() { const auth = document.getElementById('admin-auth'); const app = document.getElementById('admin-app'); auth.hidden = false; auth.style.display = 'grid'; app.hidden = true; app.style.display = 'none'; }
function showAdminApp() { const auth = document.getElementById('admin-auth'); const app = document.getElementById('admin-app'); auth.hidden = true; auth.style.display = 'none'; app.hidden = false; app.style.display = 'block'; }
function setAdminAuthMode(mode) {
  adminAuthMode = mode;
  const register = mode === 'register';
  document.getElementById('admin-auth-title').textContent = register ? 'Thiết lập admin đầu tiên' : 'Đăng nhập quản trị';
  document.getElementById('admin-auth-note').textContent = register ? 'Tạo tài khoản admin để dùng trong giai đoạn thử nghiệm.' : 'Chỉ tài khoản admin mới có thể truy cập dashboard.';
  document.getElementById('admin-auth-submit').textContent = register ? 'Tạo tài khoản admin' : 'Đăng nhập';
  document.getElementById('admin-auth-switch').textContent = register ? 'Quay lại đăng nhập' : 'Thiết lập admin đầu tiên';
  document.getElementById('admin-password').minLength = register ? 8 : 6;
}
async function submitAdminAuth(event) {
  event.preventDefault();
  const errorBox = document.getElementById('admin-auth-error'); errorBox.textContent = '';
  const body = { email: document.getElementById('admin-email').value.trim().toLowerCase(), password: document.getElementById('admin-password').value };
  try {
    const response = await fetch(`/api/admin/${adminAuthMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Không thể xác thực admin.');
    showAdminApp(); await refreshAdminState();
  } catch (error) { errorBox.textContent = error.message; }
}

async function checkAdminSession() {
  try { const response = await fetch('/api/admin/me', { credentials: 'same-origin' }); if (!response.ok) throw new Error(); showAdminApp(); refreshAdminState(); }
  catch { showAdminAuth(); }
}

function renderReport(report) {
  const totals = report.totals || {};
  document.getElementById('admin-stats').innerHTML = [
    ['Người dùng', totals.users || 0], ['Tổng sự kiện', totals.events || 0], ['Lượt xem job', totals.view || 0], ['Lượt thích', totals.like || 0], ['Ứng tuyển', totals.apply || 0],
  ].map(([label, value]) => `<div class="admin-stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
  document.getElementById('popular-jobs-body').innerHTML = (report.popularJobs || []).slice(0, 20).map((job) => `<tr><td>${escapeHtml(job.jobTitle)}</td><td>${job.views}</td><td>${job.likes}</td><td>${job.skips}</td></tr>`).join('') || '<tr><td colspan="4">Chưa có dữ liệu hành vi.</td></tr>';
  document.getElementById('users-body').innerHTML = (report.users || []).slice(0, 50).map((user) => `<tr><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.profile?.category || '—')}</td><td>${escapeHtml(user.profile?.location || '—')}</td><td>${escapeHtml(user.profile?.workType || '—')}</td></tr>`).join('') || '<tr><td colspan="4">Chưa có người dùng.</td></tr>';
  document.getElementById('events-body').innerHTML = (report.recentEvents || []).slice(0, 50).map((event) => `<tr><td>${new Date(event.timestamp).toLocaleString('vi-VN')}</td><td>${escapeHtml(event.email)}</td><td>${actionLabels[event.type] || escapeHtml(event.type)}</td><td>${escapeHtml(event.jobTitle || event.jobId)}</td></tr>`).join('') || '<tr><td colspan="4">Chưa có hoạt động.</td></tr>';
}

async function handleUpload() {
  const input = document.getElementById('pptx-file');
  const file = input?.files?.[0];
  if (!file) { alert('Vui lòng chọn video.'); return; }
  const button = document.getElementById('upload-btn');
  button.disabled = true; button.textContent = 'Đang upload…';
  try {
    const formData = new FormData(); formData.append('pptx-file', file);
    const slot = document.getElementById('video-slot')?.value || 'intro';
    const response = await fetch(`/api/upload-presentation?slot=${encodeURIComponent(slot)}`, { method: 'POST', credentials: 'same-origin', body: formData });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Upload thất bại');
    await refreshAdminState();
  } catch (error) { alert(error.message); } finally { button.disabled = false; button.textContent = 'Upload video'; }
}

async function handleClear() {
  if (!confirm('Xóa video hành trình hiện tại?')) return;
  const slot = document.getElementById('video-slot')?.value || 'intro';
  const response = await fetch(`/api/clear-presentation?slot=${encodeURIComponent(slot)}`, { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) alert('Không thể xóa video.');
  await refreshAdminState();
}

function downloadReport() {
  if (!latestReport) return;
  const rows = [['BÁO CÁO TỔNG HỢP RECRUITMENT STORY'], [], ['TỔNG QUAN', 'GIÁ TRỊ'], ...Object.entries(latestReport.totals || {}), [], ['JOB ĐƯỢC QUAN TÂM', 'LƯỢT XEM', 'LƯỢT THÍCH', 'LƯỢT BỎ QUA'], ...(latestReport.popularJobs || []).map((job) => [job.jobTitle, job.views, job.likes, job.skips]), [], ['HỒ SƠ NGƯỜI DÙNG', 'NHÓM NGHỀ', 'ĐỊA ĐIỂM', 'HÌNH THỨC LÀM VIỆC'], ...(latestReport.users || []).map((user) => [user.email, user.profile?.category || '', user.profile?.location || '', user.profile?.workType || '']), [], ['HOẠT ĐỘNG GẦN ĐÂY', 'EMAIL', 'HÀNH ĐỘNG', 'JOB'], ...(latestReport.recentEvents || []).map((event) => [new Date(event.timestamp).toLocaleString('vi-VN'), event.email, actionLabels[event.type] || event.type, event.jobTitle || event.jobId])];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `recruitment-report-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
}

document.addEventListener('DOMContentLoaded', () => { setAdminAuthMode('login'); checkAdminSession(); document.getElementById('admin-auth-form')?.addEventListener('submit', submitAdminAuth); document.getElementById('admin-auth-switch')?.addEventListener('click', () => setAdminAuthMode(adminAuthMode === 'login' ? 'register' : 'login')); document.getElementById('admin-logout')?.addEventListener('click', async () => { await fetch('/api/admin/logout', { method: 'POST' }); showAdminAuth(); }); document.getElementById('upload-btn')?.addEventListener('click', handleUpload); document.getElementById('clear-btn')?.addEventListener('click', handleClear); document.getElementById('download-report-btn')?.addEventListener('click', downloadReport); });
