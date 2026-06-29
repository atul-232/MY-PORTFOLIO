// Override window.fetch to support running from file:// protocol
const originalFetch = window.fetch;
window.fetch = function(url, options) {
  const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
  if (typeof url === 'string' && url.startsWith('/api/')) {
    url = apiBase + url;
  }
  return originalFetch(url, options);
};

// Global Application State
let token = localStorage.getItem('adminToken') || '';
let portfolioData = null;
let currentProjects = [];
let recentMessages = [];
let unsavedChanges = false;
let visitorLogs = [];

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const authOverlay = document.getElementById('auth-overlay');
  const dashboardLayout = document.getElementById('dashboard-layout');
  const authForm = document.getElementById('auth-form');
  const authBtn = document.getElementById('auth-btn');
  const logoutBtn = document.getElementById('logout-btn');

  // Verify login token
  verifySessionToken(token).then(isValid => {
    if (isValid) {
      showDashboard();
    } else {
      showLogin();
    }
  });

  // Login form submit handler
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    document.getElementById('auth-email-error').style.display = 'none';
    document.getElementById('auth-password-error').style.display = 'none';

    let hasError = false;
    if (!email || !email.includes('@')) {
      document.getElementById('auth-email-error').style.display = 'block';
      hasError = true;
    }
    if (!password || password.length < 6) {
      document.getElementById('auth-password-error').style.display = 'block';
      hasError = true;
    }

    if (hasError) return;

    authBtn.disabled = true;
    authBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        token = data.token;
        localStorage.setItem('adminToken', token);
        showDashboard();
      } else {
        alert(data.error || 'Invalid credentials');
      }
    } catch {
      alert('Authentication server unreachable');
    } finally {
      authBtn.disabled = false;
      authBtn.innerHTML = '<span>LOGIN</span>';
    }
  });

  // Sign out button
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    localStorage.removeItem('adminToken');
    token = '';
    showLogin();
  });

  // Sidebar section selectors switching
  const menuButtons = document.querySelectorAll('.sidebar-item');
  menuButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      menuButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sectionId = btn.getAttribute('data-section');
      switchSection(sectionId);
    });
  });

  // Profile widget dropdown menu toggle
  const profileWidget = document.getElementById('sidebar-profile-widget');
  const profileDropdown = document.getElementById('profile-dropdown');
  profileWidget.addEventListener('click', (e) => {
    e.stopPropagation();
    profileDropdown.classList.toggle('show');
  });
  document.addEventListener('click', () => {
    profileDropdown.classList.remove('show');
  });

  // Theme Night mode selector inside dashboard header
  const headerThemeBtn = document.getElementById('header-theme-toggle');
  let darkState = localStorage.getItem('theme') === 'dark';
  document.body.classList.toggle('dark-mode', darkState);
  updateHeaderThemeIcon();

  headerThemeBtn.addEventListener('click', () => {
    darkState = !darkState;
    document.body.classList.toggle('dark-mode', darkState);
    localStorage.setItem('theme', darkState ? 'dark' : 'light');
    updateHeaderThemeIcon();
  });

  function updateHeaderThemeIcon() {
    const icon = headerThemeBtn.querySelector('i');
    icon.className = darkState ? 'fa-solid fa-sun' : 'fa-regular fa-moon';
  }

  // Sidebar Toggler Collapse Handler
  const sidebar = document.querySelector('.dash-sidebar');
  const menuToggle = document.querySelector('.menu-toggle-btn');
  menuToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  // Portfolio details sub-tabs switcher
  const subTabButtons = document.querySelectorAll('.sub-tab-btn[data-tab]');
  subTabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      subTabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const tabGroup = btn.getAttribute('data-tab');
      const form = btn.closest('form');
      form.querySelectorAll('.modal-tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(tabGroup).classList.add('active');
    });
  });

  // Project Modal subtabs switcher
  const modalTabButtons = document.querySelectorAll('.sub-tab-btn[data-modal-tab]');
  modalTabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      modalTabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const modalGroup = btn.getAttribute('data-modal-tab');
      const container = btn.closest('.modal-body') || btn.closest('.modal-content') || document;
      container.querySelectorAll('.modal-tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(modalGroup).classList.add('active');
    });
  });

  // Save compile floats triggers
  document.getElementById('unsaved-reset-btn').onclick = resetUnsavedChanges;
  document.getElementById('unsaved-save-btn').onclick = saveCompileDatabase;

  // Add items buttons
  document.getElementById('add-skill-group-btn').onclick = addSkillGroupRow;
  document.getElementById('add-exp-btn').onclick = addExperienceGroupRow;
  document.getElementById('add-edu-btn').onclick = addEducationGroupRow;
  document.getElementById('add-cert-btn').onclick = addCertificateGroupRow;
  document.getElementById('add-ach-btn').onclick = addAchievementGroupRow;
  // Analytics Manager Hooks
  document.getElementById('ana-base-visitors').addEventListener('input', markAsUnsaved);
  document.getElementById('ana-base-views').addEventListener('input', markAsUnsaved);

  const customAnalyticsForm = document.getElementById('form-analytics-custom');
  customAnalyticsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('ana-custom-type').value;
    const country = document.getElementById('ana-custom-country').value.trim();
    const ip = document.getElementById('ana-custom-ip').value.trim() || '127.0.0.1';
    const time = document.getElementById('ana-custom-time').value;

    try {
      const res = await fetch('/api/analytics/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'add',
          logEntry: { type, country, ip, time }
        })
      });
      if (res.ok) {
        alert('Custom visit logged successfully.');
        customAnalyticsForm.reset();
        loadAnalyticsManagerSection();
        renderDashboardOverview();
      } else {
        alert('Failed to log custom visit.');
      }
    } catch {
      alert('Connection error logging visit.');
    }
  });

  document.getElementById('analytics-clear-btn').onclick = async () => {
    if (confirm('Clear all visitor logs from database? (Base counts will remain intact)')) {
      try {
        const res = await fetch('/api/analytics/action', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ action: 'clear' })
        });
        if (res.ok) {
          alert('Analytics logs cleared successfully.');
          loadAnalyticsManagerSection();
          renderDashboardOverview();
        }
      } catch {
        alert('Error clearing logs.');
      }
    }
  };

  // Project Tags collector tags-input-box click listener
  const tagsWrapper = document.getElementById('proj-field-tags-wrapper');
  const tagsInput = document.getElementById('proj-field-tags-input');
  tagsWrapper.addEventListener('click', () => tagsInput.focus());

  tagsInput.addEventListener('keydown', (e) => {
    if (e.key === ',' || e.key === 'Enter') {
      e.preventDefault();
      const val = tagsInput.value.trim().replace(/,/g, '');
      if (val) {
        addProjectTagBubble(val);
        tagsInput.value = '';
      }
    }
  });

  // Project Modal Save Trigger
  document.getElementById('proj-modal-save-btn').onclick = saveProjectModalItem;

  // Security Credentials form Update
  const securityForm = document.getElementById('form-security');
  const securityError = document.getElementById('sec-form-error');
  securityError.style.display = 'none';

  securityForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('sec-form-email').value.trim();
    const pass = document.getElementById('sec-form-password').value;
    const confirmPass = document.getElementById('sec-form-password-confirm').value;

    if (pass !== confirmPass) {
      securityError.textContent = 'Passwords do not match!';
      securityError.style.display = 'block';
      return;
    }
    securityError.style.display = 'none';

    try {
      const res = await fetch('/api/settings/security', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ email, password: pass })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert('Credentials updated successfully. Please sign out and sign back in.');
        securityForm.reset();
      } else {
        alert(data.error || 'Failed to update credentials.');
      }
    } catch {
      alert('Security update connection failed.');
    }
  });

  // SEO Settings Form Submit
  const seoForm = document.getElementById('form-seo');
  seoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    portfolioData.seo = {
      title: document.getElementById('seo-form-title').value.trim(),
      description: document.getElementById('seo-form-desc').value.trim()
    };
    markAsUnsaved();
    alert('SEO settings saved locally. Press Save & Compile at the bottom to publish!');
  });

  // Portfolio fields changes trackers
  const trackFields = [
    'p-form-name', 'p-form-title', 'p-form-location', 'p-form-edu-brief',
    'p-form-email', 'p-form-status', 'p-form-bio', 'p-form-summary',
    'p-form-years', 'p-form-completed', 'p-form-mastered', 'p-form-dsa',
    'p-form-github', 'p-form-linkedin', 'p-form-twitter'
  ];
  trackFields.forEach(fid => {
    document.getElementById(fid).addEventListener('input', markAsUnsaved);
  });

  // Uploaders: Profile picture Base64 encoder
  const avatarInput = document.getElementById('port-avatar-input');
  avatarInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const base64 = await convertFileToBase64(file);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          fileName: file.name,
          fileType: 'avatars',
          fileData: base64
        })
      });
      const data = await res.json();
      if (res.ok && data.fileUrl) {
        document.getElementById('port-avatar-preview').src = data.fileUrl;
        document.getElementById('sidebar-profile-avatar').src = data.fileUrl;
        document.getElementById('header-profile-avatar').src = data.fileUrl;
        portfolioData.personal.image = data.fileUrl;
        
        // Auto-save silently to database
        await saveCompileDatabaseSilently();
        alert('Photo uploaded and updated successfully everywhere!');
      } else {
        alert(data.error || 'Avatar upload failed.');
      }
    } catch {
      alert('Error parsing or uploading avatar file.');
    }
  });

  // Remove Avatar button click
  document.getElementById('port-avatar-remove').addEventListener('click', async () => {
    const defaultAvatar = 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
    document.getElementById('port-avatar-preview').src = defaultAvatar;
    document.getElementById('sidebar-profile-avatar').src = defaultAvatar;
    document.getElementById('header-profile-avatar').src = defaultAvatar;
    portfolioData.personal.image = defaultAvatar;
    
    // Auto-save silently to database
    await saveCompileDatabaseSilently();
    alert('Photo removed and updated successfully everywhere!');
  });

  // Uploaders: Project thumbnail Base64 uploader
  const projThumbInput = document.getElementById('proj-field-thumb-input');
  projThumbInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const base64 = await convertFileToBase64(file);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          fileName: file.name,
          fileType: 'projects',
          fileData: base64
        })
      });
      const data = await res.json();
      if (res.ok && data.fileUrl) {
        document.getElementById('proj-field-thumb-url').value = data.fileUrl;
        document.getElementById('modal-proj-thumb-preview').innerHTML = `<img src="${data.fileUrl}" style="width:100%; height:100%; object-fit:cover;">`;
      } else {
        alert(data.error || 'Project thumbnail upload failed.');
      }
    } catch {
      alert('Error parsing or uploading thumbnail file.');
    }
  });

  // Uploaders: CV Resume PDF Drag & drop or input uploader
  const cvInput = document.getElementById('port-cv-input');
  cvInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadCvPdfFile(file);
  });

  const cvDropzone = document.getElementById('cv-dropzone');
  cvDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    cvDropzone.style.borderColor = 'var(--primary)';
  });
  cvDropzone.addEventListener('dragleave', () => {
    cvDropzone.style.borderColor = 'var(--border)';
  });
  cvDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    cvDropzone.style.borderColor = 'var(--border)';
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      uploadCvPdfFile(file);
    } else {
      alert('Only PDF files are supported.');
    }
  });

  async function uploadCvPdfFile(file) {
    document.getElementById('cv-label-name').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading PDF...';
    try {
      const base64 = await convertFileToBase64(file);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          fileName: file.name,
          fileType: 'cv',
          fileData: base64
        })
      });
      const data = await res.json();
      if (res.ok && data.fileUrl) {
        portfolioData.personal.resumeUrl = data.fileUrl;
        markAsUnsaved();
        renderCvPreviewBox(file.name, data.fileUrl);
      } else {
        alert(data.error || 'PDF upload failed.');
        resetCvDropzoneText();
      }
    } catch {
      alert('Error parsing or uploading PDF resume.');
      resetCvDropzoneText();
    }
  }

  function resetCvDropzoneText() {
    document.getElementById('cv-label-name').textContent = 'Drag & drop your CV PDF here or click to select';
  }

  document.getElementById('cv-delete-btn').addEventListener('click', () => {
    portfolioData.personal.resumeUrl = '#';
    markAsUnsaved();
    document.getElementById('cv-action-box').style.display = 'none';
    document.getElementById('cv-dropzone').style.display = 'block';
    resetCvDropzoneText();
  });
});

// Switch views section tabs
function switchSection(sectionId) {
  const sections = document.querySelectorAll('.dash-section');
  sections.forEach(s => s.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');

  // Activate matching menu button
  const menuButtons = document.querySelectorAll('.sidebar-item');
  menuButtons.forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-section') === sectionId) {
      btn.classList.add('active');
    }
  });

  // Pull fresh messages if Messages is clicked
  if (sectionId === 'sec-messages') {
    fetchMessages();
  }
  if (sectionId === 'sec-analytics') {
    loadAnalyticsManagerSection();
  }
}

// Check session tokens validity
async function verifySessionToken(tok) {
  if (!tok) return false;
  try {
    const res = await fetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${tok}` }
    });
    const data = await res.json();
    return data.valid === true;
  } catch {
    return false;
  }
}

function showLogin() {
  document.getElementById('auth-overlay').classList.remove('hidden');
  document.getElementById('dashboard-layout').style.display = 'none';
  document.getElementById('unsaved-compile-bar').style.display = 'none';
}

function showDashboard() {
  document.getElementById('auth-overlay').classList.add('hidden');
  document.getElementById('dashboard-layout').style.display = 'grid';
  loadDataset();
  fetchMessages();
  fetchAnalytics();
}

// Convert files to base64 encoding strings
function convertFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// Load portfolio dynamic dataset
async function loadDataset() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error('Query error');
    portfolioData = await res.json();
    
    currentProjects = portfolioData.projects || [];
    
    populateFormInputs();
    renderDashboardOverview();
    renderProjectsTable();
    renderSkillsCards();
    renderExperienceTimeline();
    renderEducationTimeline();
    renderCertificatesList();
    renderAchievementsList();
  } catch (err) {
    console.error('loadDataset failed with error:', err);
    alert('Failed to connect and read portfolio database.');
  }
}

// Populate Edit forms inputs from dataset
function populateFormInputs() {
  if (!portfolioData) return;

  const p = portfolioData.personal || {};

  // Header Avatar
  if (p.image && p.image !== 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png') {
    document.getElementById('port-avatar-preview').src = p.image;
    document.getElementById('sidebar-profile-avatar').src = p.image;
    document.getElementById('header-profile-avatar').src = p.image;
  }

  document.getElementById('sidebar-profile-name').textContent = p.name || 'Atul Pandey';

  // Personal Info Form
  document.getElementById('p-form-name').value = p.name || '';
  document.getElementById('p-form-title').value = p.title || '';
  document.getElementById('p-form-location').value = p.location || '';
  document.getElementById('p-form-edu-brief').value = p.educationBrief || '';
  document.getElementById('p-form-email').value = p.email || '';
  document.getElementById('p-form-status').value = p.status || '';
  document.getElementById('p-form-bio').value = p.bio || '';
  document.getElementById('p-form-summary').value = p.summary || '';

  // Hero Section fields
  if (document.getElementById('p-form-hero-prefix')) {
    document.getElementById('p-form-hero-prefix').value = p.heroPrefix || "Hi, I'm ";
  }

  // Stats Metrics Form
  document.getElementById('p-form-years').value = p.yearsOfLearning || '';
  document.getElementById('p-form-completed').value = p.projectsCompleted || '';
  document.getElementById('p-form-mastered').value = p.technologiesMastered || '';
  document.getElementById('p-form-dsa').value = p.dsaProblemsSolved || '';

  // Social Links Form
  document.getElementById('p-form-github').value = p.github || '';
  document.getElementById('p-form-linkedin').value = p.linkedin || '';
  document.getElementById('p-form-twitter').value = p.twitter || '';

  // Users Form details
  document.getElementById('sec-form-email').value = p.email || 'admin@portfolio.com';

  // Site SEO Details Form
  const seo = portfolioData.seo || {};
  document.getElementById('seo-form-title').value = seo.title || '';
  document.getElementById('seo-form-desc').value = seo.description || '';

  // Render CV Resume file block
  if (p.resumeUrl && p.resumeUrl !== '#') {
    const filename = p.resumeUrl.split('/').pop().split('?')[0] || 'resume.pdf';
    renderCvPreviewBox(filename, p.resumeUrl);
  } else {
    document.getElementById('cv-action-box').style.display = 'none';
    document.getElementById('cv-dropzone').style.display = 'block';
  }

  // Analytics base stats offsets fields
  const siteSettings = portfolioData.siteSettings || {};
  const base = siteSettings.analyticsBase || { visitors: 0, views: 0 };
  document.getElementById('ana-base-visitors').value = base.visitors;
  document.getElementById('ana-base-views').value = base.views;

  // Animation settings
  const anim = portfolioData.animation || {};
  document.getElementById('anim-type-speed').value = anim.typeSpeed || 150;
  document.getElementById('anim-erase-speed').value = anim.eraseSpeed || 80;
  document.getElementById('anim-pause-end').value = anim.pauseEnd || 1500;
  document.getElementById('anim-pause-next').value = anim.pauseNext || 500;
  renderAnimationTaglinesList(anim.taglines || []);

  // LeetCode username
  if (document.getElementById('p-form-leetcode')) {
    document.getElementById('p-form-leetcode').value = p.leetcodeUsername || '';
  }
}

function renderCvPreviewBox(filename, url) {
  document.getElementById('cv-dropzone').style.display = 'none';
  const actionBox = document.getElementById('cv-action-box');
  actionBox.style.display = 'block';
  document.getElementById('cv-meta-filename').textContent = filename;
  document.getElementById('cv-download-link').href = url;
  const directDl = document.getElementById('cv-download-direct');
  if (directDl) { directDl.href = url; }
  // pre-fill the URL field too
  const urlInput = document.getElementById('cv-direct-url');
  if (urlInput && url && url !== '#') urlInput.value = url;
}

function applyDirectCvUrl() {
  const url = document.getElementById('cv-direct-url').value.trim();
  if (!url) { alert('Please paste a valid URL.'); return; }
  portfolioData.personal.resumeUrl = url;
  markAsUnsaved();
  const filename = url.split('/').pop().split('?')[0] || 'resume.pdf';
  renderCvPreviewBox(filename, url);
}

// Pull Form inputs values to memory state dataset
function collectFormInputs() {
  if (!portfolioData) return;

  const p = portfolioData.personal;
  p.name = document.getElementById('p-form-name').value.trim();
  p.title = document.getElementById('p-form-title').value.trim();
  p.location = document.getElementById('p-form-location').value.trim();
  p.educationBrief = document.getElementById('p-form-edu-brief').value.trim();
  p.email = document.getElementById('p-form-email').value.trim();
  p.status = document.getElementById('p-form-status').value.trim();
  p.bio = document.getElementById('p-form-bio').value.trim();
  p.summary = document.getElementById('p-form-summary').value.trim();
  if (document.getElementById('p-form-hero-prefix')) {
    p.heroPrefix = document.getElementById('p-form-hero-prefix').value.trim() || "Hi, I'm ";
  }

  p.yearsOfLearning = document.getElementById('p-form-years').value.trim();
  p.projectsCompleted = document.getElementById('p-form-completed').value.trim();
  p.technologiesMastered = document.getElementById('p-form-mastered').value.trim();
  p.dsaProblemsSolved = document.getElementById('p-form-dsa').value.trim();

  p.github = document.getElementById('p-form-github').value.trim();
  p.linkedin = document.getElementById('p-form-linkedin').value.trim();
  p.twitter = document.getElementById('p-form-twitter').value.trim();
  if (document.getElementById('p-form-leetcode')) {
    p.leetcodeUsername = document.getElementById('p-form-leetcode').value.trim();
  }

  // Save animation settings
  portfolioData.animation = {
    taglines: collectAnimationTaglines(),
    typeSpeed: parseInt(document.getElementById('anim-type-speed').value) || 150,
    eraseSpeed: parseInt(document.getElementById('anim-erase-speed').value) || 80,
    pauseEnd: parseInt(document.getElementById('anim-pause-end').value) || 1500,
    pauseNext: parseInt(document.getElementById('anim-pause-next').value) || 500
  };

  // Consolidate current sub-cards listings in tables
  portfolioData.projects = currentProjects;
  portfolioData.skills = collectSkillsFromCards();
  portfolioData.experience = collectExperienceTimeline();
  portfolioData.education = collectEducationTimeline();
  portfolioData.certificates = collectCertificatesList();
  portfolioData.achievements = collectAchievementsList();
  
  if (!portfolioData.siteSettings) portfolioData.siteSettings = {};
  portfolioData.siteSettings.analyticsBase = {
    visitors: parseInt(document.getElementById('ana-base-visitors').value) || 0,
    views: parseInt(document.getElementById('ana-base-views').value) || 0
  };
}

// ================================================
//  TYPING ANIMATION EDITOR — Admin Panel Functions
// ================================================

const DEFAULT_TAGLINES = ['a Software Engineer', 'a Full Stack Developer', 'an ML Specialist', 'a Problem Solver'];

function renderAnimationTaglinesList(taglines) {
  const list = document.getElementById('animation-taglines-list');
  if (!list) return;
  list.innerHTML = '';

  const items = (taglines && taglines.length > 0) ? taglines : DEFAULT_TAGLINES;

  items.forEach((text, idx) => {
    const row = document.createElement('div');
    row.className = 'anim-tagline-row';
    row.style.cssText = 'display:flex; align-items:center; gap:10px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:10px; padding:10px 14px;';
    row.innerHTML = `
      <div style="width:28px; height:28px; background:linear-gradient(135deg,#7C5CFF,#A78BFA); border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:11px; font-weight:800; color:#fff;">${idx + 1}</div>
      <input type="text" class="anim-tagline-input" value="${text}" placeholder="e.g. a Full Stack Developer"
        style="flex:1; border:none; background:transparent; font-size:14px; font-weight:500; color:var(--text-heading); outline:none;"
        oninput="markAsUnsaved(); updateAnimPreview(this.value)">
      <span style="font-size:12px; color:var(--text-paragraph); white-space:nowrap;">Hi, I'm <b style="color:var(--primary);">${text || '...'}</b></span>
      <button type="button" onclick="removeAnimationTagline(${idx})" style="background:none; border:none; cursor:pointer; color:#EF4444; font-size:16px; padding:0 4px; transition:opacity 0.2s;" title="Remove this line">
        <i class="fa-regular fa-trash-can"></i>
      </button>
    `;
    list.appendChild(row);
  });

  // Update preview with first tagline
  if (items.length > 0) updateAnimPreview(items[0]);
}

function addAnimationTagline() {
  const taglines = collectAnimationTaglines();
  taglines.push('a New Role Here');
  renderAnimationTaglinesList(taglines);
  markAsUnsaved();
  // Focus the newly added input
  const inputs = document.querySelectorAll('.anim-tagline-input');
  if (inputs.length > 0) {
    const last = inputs[inputs.length - 1];
    last.focus();
    last.select();
  }
}

function removeAnimationTagline(idx) {
  const taglines = collectAnimationTaglines();
  if (taglines.length <= 1) { alert('You need at least one animation line.'); return; }
  taglines.splice(idx, 1);
  renderAnimationTaglinesList(taglines);
  markAsUnsaved();
}

function collectAnimationTaglines() {
  const inputs = document.querySelectorAll('.anim-tagline-input');
  return Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
}

let animPreviewTimer = null;
function updateAnimPreview(text) {
  const preview = document.getElementById('anim-preview-text');
  if (!preview) return;
  clearTimeout(animPreviewTimer);
  animPreviewTimer = setTimeout(() => {
    preview.textContent = text || '...';
  }, 300);
}


function markAsUnsaved() {
  unsavedChanges = true;
  document.getElementById('unsaved-compile-bar').style.display = 'flex';
}

function clearUnsavedIndicator() {
  unsavedChanges = false;
  document.getElementById('unsaved-compile-bar').style.display = 'none';
}

function resetUnsavedChanges() {
  if (confirm('Discard your unsaved settings?')) {
    loadDataset();
    clearUnsavedIndicator();
  }
}

// POST Consolidated memory state back to backend database
async function saveCompileDatabase() {
  collectFormInputs();

  try {
    const res = await fetch('/api/save-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(portfolioData)
    });
    const data = await res.json();
    
    if (res.ok && data.success) {
      alert('Portfolio modifications compiled and saved successfully!');
      clearUnsavedIndicator();
      loadDataset(); // reload state
    } else {
      alert(data.error || 'Failed to save dataset.');
    }
  } catch {
    alert('Save and compile request connection error.');
  }
}

// Render Dashboard Panel metrics, sparklines and analytical trends
let analyticsChart = null;
let currentDateRangeDays = 30; // default

function toggleDateDropdown() {
  const menu = document.getElementById('date-dropdown-menu');
  const chevron = document.getElementById('date-chevron');
  const isOpen = menu.style.display === 'block';
  menu.style.display = isOpen ? 'none' : 'block';
  chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
}

function selectDateRange(event, days, label) {
  event.stopPropagation(); // don't bubble to toggleDateDropdown
  currentDateRangeDays = days;
  document.getElementById('dashboard-date-range').textContent = label;

  // Update active button
  document.querySelectorAll('.date-range-option').forEach(btn => btn.classList.remove('active'));
  event.currentTarget.classList.add('active');

  // Close dropdown
  document.getElementById('date-dropdown-menu').style.display = 'none';
  document.getElementById('date-chevron').style.transform = 'rotate(0deg)';

  // Reload analytics with new range
  renderDashboardOverview(days);
}

// Close dropdown if user clicks outside of it
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('date-dropdown-btn');
  const menu = document.getElementById('date-dropdown-menu');
  if (dropdown && menu && !dropdown.contains(e.target)) {
    menu.style.display = 'none';
    const chevron = document.getElementById('date-chevron');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  }
});

async function renderDashboardOverview(days = 30) {
  try {
    const params = days > 0 ? `?days=${days}` : '';
    const res = await fetch(`/api/analytics/summary${params}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const summary = await res.json();

    // Update stats cards numbers
    document.querySelector('.dash-stat-card.visitors h2').textContent = summary.totalVisitors.toLocaleString();
    document.querySelector('.dash-stat-card.views h2').textContent = summary.totalViews.toLocaleString();
    document.getElementById('dash-card-messages').textContent = summary.totalMessages.toLocaleString();
    document.getElementById('dash-card-projects').textContent = summary.totalProjects.toLocaleString();

    // Keep date range label in sync (only update if not already set by picker)
    if (days === 30 && document.getElementById('dashboard-date-range').textContent === 'Last 30 Days') {
      const today = new Date();
      const from = new Date();
      from.setDate(today.getDate() - 30);
      document.getElementById('dashboard-date-range').textContent =
        `${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    // Helper to update trend display
    const updateTrendWidget = (metricKey, val) => {
      const box = document.getElementById(`trend-box-${metricKey}`);
      const icon = document.getElementById(`trend-icon-${metricKey}`);
      const valEl = document.getElementById(`trend-val-${metricKey}`);
      if (!box || !icon || !valEl) return;

      const isUp = val >= 0;
      box.className = `dash-stat-trend ${isUp ? 'up' : 'down'}`;
      icon.className = `fa-solid ${isUp ? 'fa-arrow-up' : 'fa-arrow-down'}`;
      valEl.textContent = `${Math.abs(val)}%`;
    };

    const trends = summary.trends || { visitors: 0, views: 0, messages: 0, projects: 0 };
    updateTrendWidget('visitors', trends.visitors);
    updateTrendWidget('views', trends.views);
    updateTrendWidget('messages', trends.messages);
    updateTrendWidget('projects', trends.projects);

    // Generate sparklines based on real chart data slices
    const visitorsChartData = summary.chart.visitors;
    const viewsChartData = summary.chart.views;
    
    // Sparkline segments (fill with dynamic slices of data)
    renderSparkline('sparkline-visitors', visitorsChartData, 'var(--primary)');
    renderSparkline('sparkline-views', viewsChartData, '#3B82F6');
    renderSparkline('sparkline-messages', [0, 1, 0, 2, 0, 1, summary.totalMessages], 'var(--success)');
    renderSparkline('sparkline-projects', [1, 2, 2, 3, 3, 4, summary.totalProjects], '#F97316');

    // Chart.js updates
    const ctx = document.getElementById('dashboard-analytics-chart').getContext('2d');
    
    if (analyticsChart) analyticsChart.destroy();

    const chartGradient = ctx.createLinearGradient(0, 0, 0, 300);
    chartGradient.addColorStop(0, 'rgba(124, 92, 255, 0.25)');
    chartGradient.addColorStop(1, 'rgba(124, 92, 255, 0)');

    const maxVal = Math.max(...viewsChartData, ...visitorsChartData, 100);
    const stepSize = Math.ceil(maxVal / 5);

    const chartConfig = {
      type: 'line',
      data: {
        labels: summary.chart.labels,
        datasets: [{
          label: 'Visitors Trend',
          data: summary.chart.visitors,
          borderColor: '#7C5CFF',
          borderWidth: 3,
          pointBackgroundColor: '#FFFFFF',
          pointBorderColor: '#7C5CFF',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          fill: true,
          backgroundColor: chartGradient,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Inter', size: 11 }, color: '#9CA3AF' }
          },
          y: {
            min: 0,
            max: Math.ceil(maxVal * 1.1),
            ticks: {
              stepSize: stepSize,
              font: { family: 'Inter', size: 11 },
              color: '#9CA3AF'
            },
            grid: { color: 'rgba(229, 231, 235, 0.5)' }
          }
        }
      }
    };

    analyticsChart = new Chart(ctx, chartConfig);

    document.getElementById('chart-data-type').onchange = (e) => {
      const isViews = e.target.value === 'views';
      analyticsChart.data.datasets[0].label = isViews ? 'Profile Views Trend' : 'Visitors Trend';
      analyticsChart.data.datasets[0].data = isViews ? summary.chart.views : summary.chart.visitors;
      analyticsChart.data.datasets[0].borderColor = isViews ? '#3B82F6' : '#7C5CFF';
      analyticsChart.data.datasets[0].pointBorderColor = isViews ? '#3B82F6' : '#7C5CFF';
      analyticsChart.update();
    };

    // Render Recent Activity feed
    const activityFeed = document.getElementById('dashboard-activity-feed');
    activityFeed.innerHTML = '';
    
    if (summary.recentActivity.length === 0) {
      activityFeed.innerHTML = '<p class="text-muted text-center" style="font-size:12px;">No activity logged yet.</p>';
    } else {
      summary.recentActivity.forEach(act => {
        let icon = 'fa-regular fa-eye';
        if (act.type === 'message') icon = 'fa-regular fa-comment';
        if (act.type === 'project') icon = 'fa-solid fa-briefcase';

        const item = document.createElement('div');
        item.className = 'activity-feed-item';
        item.innerHTML = `
          <div class="activity-icon-wrapper"><i class="${icon}"></i></div>
          <div class="activity-info">
            <h4>${act.title}</h4>
            <p>${act.time}</p>
          </div>
        `;
        activityFeed.appendChild(item);
      });
    }

    // Top projects
    const topProjectsTbody = document.getElementById('dashboard-top-projects-tbody');
    topProjectsTbody.innerHTML = '';
    
    // Simulate top counts based on order index
    currentProjects.slice(0, 4).forEach((p, idx) => {
      const tr = document.createElement('tr');
      let thumb = `<i class="fa-solid fa-laptop-code"></i>`;
      if (p.image) {
        thumb = `<img src="${p.image}">`;
      }
      
      const factor = (currentProjects.length - idx) * 12;
      const computedViews = summary.totalViews > 0 ? Math.floor(summary.totalViews * (factor / 100)) : 0;
      const computedLikes = Math.floor(computedViews * 0.15);

      tr.innerHTML = `
        <td>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="proj-card-mini-thumb">${thumb}</div>
            <div>
              <div style="font-weight:600; color:var(--text-heading);">${p.title}</div>
              <div style="font-size:11px; color:var(--text-small);">${p.category}</div>
            </div>
          </div>
        </td>
        <td style="font-family:var(--font-number); font-weight:600;">${computedViews.toLocaleString()}</td>
        <td style="font-family:var(--font-number); font-weight:600; color:var(--primary);">${computedLikes.toLocaleString()}</td>
        <td><span class="tag-badge" style="padding:2px 8px; font-size:11px; background:rgba(34,197,94,0.1); color:var(--success);">${p.status}</span></td>
      `;
      topProjectsTbody.appendChild(tr);
    });

    // Skills overview progress list
    const skillsProgressWrapper = document.getElementById('dashboard-skills-progress-wrapper');
    skillsProgressWrapper.innerHTML = '';
    const skillsList = portfolioData.skills || [];
    
    if (skillsList.length === 0) {
      skillsProgressWrapper.innerHTML = '<p class="text-muted text-center">No skills details added yet.</p>';
    } else {
      const progressList = [90, 85, 80, 75, 70];
      skillsList.forEach((group, idx) => {
        const percent = progressList[idx] || 60;
        const row = document.createElement('div');
        row.className = 'progress-bar-row';
        row.innerHTML = `
          <div class="progress-bar-header">
            <span>${group.category}</span>
            <span>${percent}%</span>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: ${percent}%;"></div>
          </div>
        `;
        skillsProgressWrapper.appendChild(row);
      });
    }

  } catch (err) {
    console.error('Failed to render dashboard summary:', err);
  }
}


// Sparklines helper using SVG path drawing
function renderSparkline(elementId, values, color) {
  const container = document.getElementById(elementId);
  if (!container) return;
  container.innerHTML = '';

  const width = container.clientWidth || 200;
  const height = 40;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const points = values.map((val, idx) => {
    const x = (idx / (values.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 8) - 4;
    return `${x},${y}`;
  }).join(' ');

  container.innerHTML = `
    <svg width="${width}" height="${height}">
      <polyline fill="none" stroke="${color}" stroke-width="2" points="${points}" />
    </svg>
  `;
}

// Recent messages inbox tables renderer
async function fetchMessages() {
  try {
    const res = await fetch('/api/messages', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      recentMessages = await res.json();
      renderMessagesTable();
    }
  } catch (err) {
    console.error('Fetch messages error:', err);
  }
}

function renderMessagesTable() {
  const tbody = document.getElementById('messages-table-tbody');
  const sidebarBadge = document.getElementById('sidebar-messages-badge');
  const headerBadge = document.getElementById('header-notifications-count');
  
  tbody.innerHTML = '';

  const unreadCount = recentMessages.filter(m => m.status === 'inbox').length;
  
  if (unreadCount > 0) {
    sidebarBadge.textContent = unreadCount;
    sidebarBadge.style.display = 'inline-block';
    headerBadge.textContent = unreadCount;
    headerBadge.style.display = 'flex';
  } else {
    sidebarBadge.style.display = 'none';
    headerBadge.style.display = 'none';
  }

  if (recentMessages.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No messages received.</td></tr>';
    return;
  }

  recentMessages.forEach(m => {
    const tr = document.createElement('tr');
    
    // Status marker dot
    const statusDot = m.status === 'inbox' 
      ? `<span style="width:8px; height:8px; display:inline-block; border-radius:50%; background:var(--primary);"></span>`
      : '';

    const dateStr = new Date(m.date).toLocaleString();

    tr.innerHTML = `
      <td>${statusDot}</td>
      <td>${dateStr}</td>
      <td style="font-weight:600; color:var(--text-heading);">${m.name}</td>
      <td>${m.email}</td>
      <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${m.subject}</td>
      <td style="text-align: right;">
        <button class="action-row-btn" onclick="openMessageDetail('${m.id}')" title="Read Message"><i class="fa-regular fa-envelope-open"></i> Read</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Fetch visitor analytics logs list
async function fetchAnalytics() {
  try {
    const res = await fetch('/api/analytics', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      visitorLogs = await res.json();
    }
  } catch (err) {
    console.error('Fetch analytics logs error:', err);
  }
}

// CRUD: Tabular Projects Management rows
function renderProjectsTable() {
  const tbody = document.getElementById('projects-table-tbody');
  tbody.innerHTML = '';

  if (currentProjects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No project cards found. Click Add Project.</td></tr>';
    return;
  }

  // Sort projects by order
  currentProjects.sort((a, b) => (a.order || 99) - (b.order || 99));

  currentProjects.forEach((p, index) => {
    const tr = document.createElement('tr');
    
    let thumb = `<i class="fa-solid fa-laptop-code"></i>`;
    if (p.image) {
      thumb = `<img src="${p.image}">`;
    }

    const tagsStr = (p.tags || []).map(t => `<span class="proj-tag-badge">${t}</span>`).join(' ');

    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="action-row-btn" onclick="adjustProjectOrder(${index}, -1)" ${index === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
          <button class="action-row-btn" onclick="adjustProjectOrder(${index}, 1)" ${index === currentProjects.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
        </div>
      </td>
      <td><div class="proj-card-mini-thumb">${thumb}</div></td>
      <td>
        <div style="font-weight:600; color:var(--text-heading);">${p.title}</div>
        <div style="font-size:12px; color:var(--text-paragraph); max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.shortDescription || ''}</div>
      </td>
      <td>${p.category || ''}</td>
      <td><div style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${tagsStr}</div></td>
      <td><span class="tag-badge" style="padding:2px 8px; font-size:12px; background:rgba(124,92,255,0.1);">${p.status}</span></td>
      <td style="text-align: right;">
        <button class="action-row-btn" onclick="openEditProjectModal('${p.id}')" title="Edit"><i class="fa-regular fa-pen-to-square"></i></button>
        <button class="action-row-btn delete" onclick="deleteProjectItem('${p.id}')" title="Delete" style="margin-left:4px;"><i class="fa-regular fa-trash-can"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function adjustProjectOrder(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= currentProjects.length) return;

  // Swap order
  const temp = currentProjects[index];
  currentProjects[index] = currentProjects[targetIndex];
  currentProjects[targetIndex] = temp;

  // Recalculate index position values
  currentProjects.forEach((p, idx) => {
    p.order = idx + 1;
  });

  markAsUnsaved();
  renderProjectsTable();
}

// Modal handling logic
const projectModal = document.getElementById('project-modal');
const projectForm = document.getElementById('form-project');
const modalTitle = document.getElementById('proj-modal-title');
let selectedTags = [];

function openNewProjectModal() {
  modalTitle.textContent = 'Add New Project';
  projectForm.reset();
  document.getElementById('proj-form-id').value = '';
  document.getElementById('proj-form-order').value = currentProjects.length + 1;
  
  // Clear tags and previews
  document.getElementById('proj-field-tags-wrapper').querySelectorAll('.tag-bubble').forEach(e => e.remove());
  document.getElementById('modal-proj-thumb-preview').innerHTML = '<i class="fa-solid fa-image"></i>';
  selectedTags = [];

  // Reset tab active states inside modal
  const modalTabs = projectModal.querySelectorAll('.sub-tab-btn');
  modalTabs.forEach(b => b.classList.remove('active'));
  modalTabs[0].classList.add('active');
  projectModal.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('modal-proj-basic').classList.add('active');

  projectModal.classList.add('show');
}

function openEditProjectModal(projId) {
  const p = currentProjects.find(item => item.id === projId);
  if (!p) return;

  modalTitle.textContent = 'Edit Project Details';
  document.getElementById('proj-form-id').value = p.id;
  document.getElementById('proj-form-order').value = p.order || 1;
  document.getElementById('proj-field-title').value = p.title || '';
  document.getElementById('proj-field-slug').value = p.slug || '';
  document.getElementById('proj-field-short-desc').value = p.shortDescription || '';
  document.getElementById('proj-field-category').value = p.category || '';
  document.getElementById('proj-field-status').value = p.status || 'Live';
  document.getElementById('proj-field-featured').checked = p.featured === true;
  document.getElementById('proj-field-description').value = p.description || '';
  document.getElementById('proj-field-thumb-url').value = p.image || '';
  document.getElementById('proj-field-github').value = p.githubUrl || '';
  document.getElementById('proj-field-demo').value = p.demoUrl || '';
  document.getElementById('proj-field-duration').value = p.duration || '';
  document.getElementById('proj-field-teams').value = p.teamSize || 1;
  document.getElementById('proj-field-video').value = p.videoUrl || '';
  document.getElementById('proj-field-link-mode').value = p.linkMode || 'both';

  // Render thumbnail
  const thumbPreview = document.getElementById('modal-proj-thumb-preview');
  if (p.image) {
    thumbPreview.innerHTML = `<img src="${p.image}" style="width:100%; height:100%; object-fit:cover;">`;
  } else {
    thumbPreview.innerHTML = '<i class="fa-solid fa-image"></i>';
  }

  // Tags bubbles
  document.getElementById('proj-field-tags-wrapper').querySelectorAll('.tag-bubble').forEach(e => e.remove());
  selectedTags = [];
  (p.tags || []).forEach(tag => addProjectTagBubble(tag));

  // Reset modal subtabs
  const modalTabs = projectModal.querySelectorAll('.sub-tab-btn');
  modalTabs.forEach(b => b.classList.remove('active'));
  modalTabs[0].classList.add('active');
  projectModal.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('modal-proj-basic').classList.add('active');

  projectModal.classList.add('show');
}

function closeProjectModal() {
  projectModal.classList.remove('show');
}

function addProjectTagBubble(val) {
  if (selectedTags.includes(val)) return;
  selectedTags.push(val);

  const wrapper = document.getElementById('proj-field-tags-wrapper');
  const input = document.getElementById('proj-field-tags-input');

  const span = document.createElement('span');
  span.className = 'tag-bubble';
  span.innerHTML = `
    <span>${val}</span>
    <i class="fa-solid fa-xmark tag-bubble-close"></i>
  `;

  span.querySelector('.tag-bubble-close').onclick = (e) => {
    e.stopPropagation();
    span.remove();
    selectedTags = selectedTags.filter(t => t !== val);
  };

  wrapper.insertBefore(span, input);
}

function saveProjectModalItem() {
  const title = document.getElementById('proj-field-title').value.trim();
  const slug = document.getElementById('proj-field-slug').value.trim();
  const shortDescription = document.getElementById('proj-field-short-desc').value.trim();
  const category = document.getElementById('proj-field-category').value.trim();

  if (!title || !slug || !shortDescription || !category) {
    alert('Please fill out all required fields marked with *');
    return;
  }

  const id = document.getElementById('proj-form-id').value;
  const order = parseInt(document.getElementById('proj-form-order').value) || 1;

  const projectPayload = {
    id: id || 'proj_' + Date.now(),
    title,
    slug,
    shortDescription,
    description: document.getElementById('proj-field-description').value.trim(),
    category,
    status: document.getElementById('proj-field-status').value,
    featured: document.getElementById('proj-field-featured').checked,
    order,
    image: document.getElementById('proj-field-thumb-url').value.trim(),
    tags: selectedTags,
    githubUrl: document.getElementById('proj-field-github').value.trim(),
    demoUrl: document.getElementById('proj-field-demo').value.trim(),
    duration: document.getElementById('proj-field-duration').value.trim(),
    teamSize: parseInt(document.getElementById('proj-field-teams').value) || 1,
    videoUrl: document.getElementById('proj-field-video').value.trim(),
    linkMode: document.getElementById('proj-field-link-mode').value,
    screenshots: []
  };

  if (id) {
    // Edit existing project
    currentProjects = currentProjects.map(p => p.id === id ? projectPayload : p);
  } else {
    // Add new project
    currentProjects.push(projectPayload);
  }

  markAsUnsaved();
  renderProjectsTable();
  closeProjectModal();
  alert('Project registered locally. Press Save & Compile at the bottom to publish!');
}

function deleteProjectItem(projId) {
  if (confirm('Delete this project permanently?')) {
    currentProjects = currentProjects.filter(p => p.id !== projId);
    markAsUnsaved();
    renderProjectsTable();
  }
}

// CRUD: Skills, Experience, Education Renderers & Parsers
function renderSkillsCards() {
  const list = document.getElementById('skills-cards-list');
  list.innerHTML = '';
  const skills = portfolioData.skills || [];

  if (skills.length === 0) {
    list.innerHTML = '<p class="text-center w-full card" style="padding:30px;">No skills categories added. Click Add Group.</p>';
    return;
  }

  skills.forEach((g, idx) => {
    const card = document.createElement('div');
    card.className = 'card skill-group-card';
    card.style.marginBottom = '20px';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
        <h3 style="font-size:18px; font-weight:700;">Skill Category Group</h3>
        <button type="button" class="btn btn-secondary btn-sm" onclick="removeSkillCard(${idx})" style="color:var(--danger); border-color:var(--border);"><i class="fa-regular fa-trash-can"></i> Delete</button>
      </div>
      <div class="contact-group-row">
        <div class="form-group-field">
          <label>GROUP CATEGORY NAME *</label>
          <input type="text" class="skill-group-category-input" value="${g.category}" required placeholder="e.g. Frontend" oninput="markAsUnsaved()">
        </div>
        <div class="form-group-field">
          <label>SKILL TAG LIST * (Comma separated)</label>
          <input type="text" class="skill-group-tags-input" value="${g.list.join(', ')}" required placeholder="e.g. React, Vue, HTML" oninput="markAsUnsaved()">
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

function addSkillGroupRow() {
  const skills = collectSkillsFromCards();
  skills.push({ category: '', list: [] });
  portfolioData.skills = skills;
  markAsUnsaved();
  renderSkillsCards();
}

function removeSkillCard(idx) {
  if (confirm('Delete this skills group?')) {
    const skills = collectSkillsFromCards();
    skills.splice(idx, 1);
    portfolioData.skills = skills;
    markAsUnsaved();
    renderSkillsCards();
  }
}

function collectSkillsFromCards() {
  const cards = document.querySelectorAll('.skill-group-card');
  const arr = [];
  cards.forEach(card => {
    const category = card.querySelector('.skill-group-category-input').value.trim();
    const tagsVal = card.querySelector('.skill-group-tags-input').value;
    if (category) {
      const list = tagsVal.split(',').map(t => t.trim()).filter(Boolean);
      arr.push({ category, list });
    }
  });
  return arr;
}

// Experiencetimeline
function renderExperienceTimeline() {
  const list = document.getElementById('experience-cards-list');
  list.innerHTML = '';
  const history = portfolioData.experience || [];

  if (history.length === 0) {
    list.innerHTML = '<p class="text-center w-full card" style="padding:30px;">No career history timeline added. Click Add Job Role.</p>';
    return;
  }

  history.forEach((exp, idx) => {
    const card = document.createElement('div');
    card.className = 'card exp-item-card';
    card.style.marginBottom = '20px';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
        <h3 style="font-size:18px; font-weight:700;">Job / Internship Role</h3>
        <button type="button" class="btn btn-secondary btn-sm" onclick="removeExperienceCard(${idx})" style="color:var(--danger); border-color:var(--border);"><i class="fa-regular fa-trash-can"></i> Delete</button>
      </div>
      <div class="contact-group-row">
        <div class="form-group-field">
          <label>ORGANIZATION / COMPANY *</label>
          <input type="text" class="exp-company-input" value="${exp.company || ''}" required placeholder="Company Name" oninput="markAsUnsaved()">
        </div>
        <div class="form-group-field">
          <label>JOB TITLE / ROLE *</label>
          <input type="text" class="exp-role-input" value="${exp.role || ''}" required placeholder="Full-Stack Web Intern" oninput="markAsUnsaved()">
        </div>
      </div>
      <div class="contact-group-row" style="margin-top:10px;">
        <div class="form-group-field">
          <label>DURATION / DATES *</label>
          <input type="text" class="exp-duration-input" value="${exp.duration || ''}" required placeholder="June 2025 - Present" oninput="markAsUnsaved()">
        </div>
        <div class="form-group-field">
          <label>OFFICE LOCATION</label>
          <input type="text" class="exp-location-input" value="${exp.location || ''}" placeholder="Remote / City" oninput="markAsUnsaved()">
        </div>
      </div>
      <div class="form-group-field" style="margin-top:10px;">
        <label>RESPONSIBILITIES / DESCRIPTION * (Short paragraph)</label>
        <textarea class="exp-description-input" rows="3" placeholder="Collaborated with teams..." oninput="markAsUnsaved()">${typeof exp.description === 'string' ? exp.description : (exp.description || []).join('\n')}</textarea>
      </div>
      <div class="form-group-field" style="margin-top:10px;">
        <label>SKILLS USED (Comma separated, e.g. React, Node.js, MySQL)</label>
        <input type="text" class="exp-skills-input" value="${(exp.skills || []).join(', ')}" placeholder="React, Node.js, MySQL" oninput="markAsUnsaved()">
      </div>
    `;
    list.appendChild(card);
  });
}

function addExperienceGroupRow() {
  const history = collectExperienceTimeline();
  history.push({ company: '', role: '', duration: '', location: '', description: [] });
  portfolioData.experience = history;
  markAsUnsaved();
  renderExperienceTimeline();
}

function removeExperienceCard(idx) {
  if (confirm('Delete this career role card?')) {
    const history = collectExperienceTimeline();
    history.splice(idx, 1);
    portfolioData.experience = history;
    markAsUnsaved();
    renderExperienceTimeline();
  }
}

function collectExperienceTimeline() {
  const cards = document.querySelectorAll('.exp-item-card');
  const arr = [];
  cards.forEach(card => {
    const company = card.querySelector('.exp-company-input').value.trim();
    const role = card.querySelector('.exp-role-input').value.trim();
    const duration = card.querySelector('.exp-duration-input').value.trim();
    const location = card.querySelector('.exp-location-input').value.trim();
    const descText = card.querySelector('.exp-description-input').value.trim();
    const skillsText = card.querySelector('.exp-skills-input').value;
    
    if (company && role) {
      const skills = skillsText.split(',').map(s => s.trim()).filter(Boolean);
      arr.push({ company, role, duration, location, description: descText, skills });
    }
  });
  return arr;
}

// Education Timeline
function renderEducationTimeline() {
  const list = document.getElementById('education-cards-list');
  list.innerHTML = '';
  const edu = portfolioData.education || [];

  if (edu.length === 0) {
    list.innerHTML = '<p class="text-center w-full card" style="padding:30px;">No academic listings added. Click Add School.</p>';
    return;
  }

  edu.forEach((e, idx) => {
    const card = document.createElement('div');
    card.className = 'card edu-item-card';
    card.style.marginBottom = '20px';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
        <h3 style="font-size:18px; font-weight:700;">Academic Qualification</h3>
        <button type="button" class="btn btn-secondary btn-sm" onclick="removeEducationCard(${idx})" style="color:var(--danger); border-color:var(--border);"><i class="fa-regular fa-trash-can"></i> Delete</button>
      </div>
      <div class="contact-group-row">
        <div class="form-group-field">
          <label>INSTITUTION / UNIVERSITY *</label>
          <input type="text" class="edu-school-input" value="${e.institution || ''}" required placeholder="University Name" oninput="markAsUnsaved()">
        </div>
        <div class="form-group-field">
          <label>DEGREE / COURSE *</label>
          <input type="text" class="edu-degree-input" value="${e.degree || ''}" required placeholder="B.Com (Hons)" oninput="markAsUnsaved()">
        </div>
      </div>
      <div class="contact-group-row" style="margin-top:10px;">
        <div class="form-group-field">
          <label>DURATION / DATES *</label>
          <input type="text" class="edu-duration-input" value="${e.duration || ''}" required placeholder="2022 - 2025" oninput="markAsUnsaved()">
        </div>
        <div class="form-group-field">
          <label>GRADE / SCORE</label>
          <input type="text" class="edu-grade-input" value="${e.grade || ''}" placeholder="GPA: 8.5 / 10" oninput="markAsUnsaved()">
        </div>
      </div>
      <div class="form-group-field" style="margin-top:10px;">
        <label>DETAILS / DESCRIPTION</label>
        <textarea class="edu-details-input" rows="2" placeholder="Major in statistical models..." oninput="markAsUnsaved()">${e.description || e.details || ''}</textarea>
      </div>
      <div class="form-group-field" style="margin-top:10px;">
        <label>SKILLS / SUBJECTS (Comma separated, e.g. Financial Modeling, Statistics)</label>
        <input type="text" class="edu-skills-input" value="${(e.skills || []).join(', ')}" placeholder="Financial Modeling, Statistics" oninput="markAsUnsaved()">
      </div>
    `;
    list.appendChild(card);
  });
}

function addEducationGroupRow() {
  const edu = collectEducationTimeline();
  edu.push({ institution: '', degree: '', duration: '', grade: '', details: '' });
  portfolioData.education = edu;
  markAsUnsaved();
  renderEducationTimeline();
}

function removeEducationCard(idx) {
  if (confirm('Delete this academic card?')) {
    const edu = collectEducationTimeline();
    edu.splice(idx, 1);
    portfolioData.education = edu;
    markAsUnsaved();
    renderEducationTimeline();
  }
}

function collectEducationTimeline() {
  const cards = document.querySelectorAll('.edu-item-card');
  const arr = [];
  cards.forEach(card => {
    const institution = card.querySelector('.edu-school-input').value.trim();
    const degree = card.querySelector('.edu-degree-input').value.trim();
    const duration = card.querySelector('.edu-duration-input').value.trim();
    const grade = card.querySelector('.edu-grade-input').value.trim();
    const description = card.querySelector('.edu-details-input').value.trim();
    const skillsText = card.querySelector('.edu-skills-input').value;

    if (institution && degree) {
      const skills = skillsText.split(',').map(s => s.trim()).filter(Boolean);
      arr.push({ institution, degree, duration, grade, description, skills });
    }
  });
  return arr;
}

// Certificates Management
function renderCertificatesList() {
  const list = document.getElementById('certificates-cards-list');
  list.innerHTML = '';
  const certs = portfolioData.certificates || [];

  if (certs.length === 0) {
    list.innerHTML = '<p class="text-center w-full card" style="padding:30px;">No credentials certificates logged. Click Add Certificate.</p>';
    return;
  }

  certs.forEach((c, idx) => {
    const card = document.createElement('div');
    card.className = 'card cert-item-card';
    card.style.marginBottom = '20px';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
        <h3 style="font-size:18px; font-weight:700;">Certificate Record</h3>
        <button type="button" class="btn btn-secondary btn-sm" onclick="removeCertificateCard(${idx})" style="color:var(--danger); border-color:var(--border);"><i class="fa-regular fa-trash-can"></i> Delete</button>
      </div>
      <div class="contact-group-row">
        <div class="form-group-field">
          <label>CERTIFICATE NAME *</label>
          <input type="text" class="cert-name-input" value="${c.name || ''}" required placeholder="Machine Learning Specialization" oninput="markAsUnsaved()">
        </div>
        <div class="form-group-field">
          <label>ORGANIZATION / ISSUER *</label>
          <input type="text" class="cert-org-input" value="${c.organization || ''}" required placeholder="DeepLearning.AI" oninput="markAsUnsaved()">
        </div>
      </div>
      <div class="contact-group-row" style="margin-top:10px;">
        <div class="form-group-field">
          <label>DATE ISSUED</label>
          <input type="text" class="cert-date-input" value="${c.date || ''}" placeholder="e.g. Aug 2025" oninput="markAsUnsaved()">
        </div>
        <div class="form-group-field">
          <label>CREDENTIAL URL</label>
          <input type="text" class="cert-url-input" value="${c.credentialUrl || ''}" placeholder="Verification Link URL" oninput="markAsUnsaved()">
        </div>
      </div>
      <div class="form-group-field" style="margin-top:10px;">
        <label>IMAGE / LOGO URL (or upload)</label>
        <div style="display:flex; gap:10px; align-items:center;">
          <input type="text" class="cert-image-input" value="${c.image || ''}" placeholder="Paste image URL or upload" style="flex:1;" oninput="markAsUnsaved()">
          <input type="file" class="cert-image-file" accept="image/*" style="display:none;" onchange="uploadCertImage(this, ${idx})">
          <button type="button" class="btn btn-secondary btn-sm" onclick="this.previousElementSibling.click()" style="white-space:nowrap;"><i class="fa-solid fa-upload"></i> Upload</button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

function addCertificateGroupRow() {
  const certs = collectCertificatesList();
  certs.push({ name: '', organization: '', date: '', credentialUrl: '' });
  portfolioData.certificates = certs;
  markAsUnsaved();
  renderCertificatesList();
}

function removeCertificateCard(idx) {
  if (confirm('Delete this certificate?')) {
    const certs = collectCertificatesList();
    certs.splice(idx, 1);
    portfolioData.certificates = certs;
    markAsUnsaved();
    renderCertificatesList();
  }
}

function collectCertificatesList() {
  const cards = document.querySelectorAll('.cert-item-card');
  const arr = [];
  cards.forEach(card => {
    const name = card.querySelector('.cert-name-input').value.trim();
    const organization = card.querySelector('.cert-org-input').value.trim();
    const date = card.querySelector('.cert-date-input').value.trim();
    const credentialUrl = card.querySelector('.cert-url-input').value.trim();
    const image = card.querySelector('.cert-image-input').value.trim();

    if (name && organization) {
      arr.push({ name, organization, date, credentialUrl, image });
    }
  });
  return arr;
}

// Achievements list CRUD
function renderAchievementsList() {
  const list = document.getElementById('achievements-cards-list');
  list.innerHTML = '';
  const achs = portfolioData.achievements || [];

  if (achs.length === 0) {
    list.innerHTML = '<p class="text-center w-full card" style="padding:30px;">No awards achievements catalogued. Click Add Award Achievement.</p>';
    return;
  }

  achs.forEach((a, idx) => {
    const card = document.createElement('div');
    card.className = 'card ach-item-card';
    card.style.marginBottom = '20px';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
        <h3 style="font-size:18px; font-weight:700;">Award Record</h3>
        <button type="button" class="btn btn-secondary btn-sm" onclick="removeAchievementCard(${idx})" style="color:var(--danger); border-color:var(--border);"><i class="fa-regular fa-trash-can"></i> Delete</button>
      </div>
      <div class="contact-group-row">
        <div class="form-group-field">
          <label>AWARD / ACHIEVEMENT TITLE *</label>
          <input type="text" class="ach-title-input" value="${a.title || ''}" required placeholder="Smart India Hackathon 1st Place" oninput="markAsUnsaved()">
        </div>
        <div class="form-group-field">
          <label>ISSUER / ORGANIZATION *</label>
          <input type="text" class="ach-issuer-input" value="${a.issuer || ''}" required placeholder="Govt of India" oninput="markAsUnsaved()">
        </div>
      </div>
      <div class="contact-group-row" style="margin-top:10px;">
        <div class="form-group-field">
          <label>DATE RECEIVED</label>
          <input type="text" class="ach-date-input" value="${a.date || ''}" placeholder="Dec 2024" oninput="markAsUnsaved()">
        </div>
        <div class="form-group-field">
          <label>LINK URL (optional)</label>
          <input type="text" class="ach-link-input" value="${a.link || ''}" placeholder="https://..." oninput="markAsUnsaved()">
        </div>
      </div>
      <div class="form-group-field" style="margin-top:10px;">
        <label>AWARD DESCRIPTION</label>
        <textarea class="ach-desc-input" rows="2" placeholder="Details about selection..." oninput="markAsUnsaved()">${a.description || ''}</textarea>
      </div>
      <div class="form-group-field" style="margin-top:10px;">
        <label>IMAGE URL (or upload)</label>
        <div style="display:flex; gap:10px; align-items:center;">
          <input type="text" class="ach-image-input" value="${a.image || ''}" placeholder="Paste image URL or upload" style="flex:1;" oninput="markAsUnsaved()">
          <input type="file" class="ach-image-file" accept="image/*" style="display:none;" onchange="uploadAchImage(this, ${idx})">
          <button type="button" class="btn btn-secondary btn-sm" onclick="this.previousElementSibling.click()" style="white-space:nowrap;"><i class="fa-solid fa-upload"></i> Upload</button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

function addAchievementGroupRow() {
  const achs = collectAchievementsList();
  achs.push({ title: '', issuer: '', date: '', description: '' });
  portfolioData.achievements = achs;
  markAsUnsaved();
  renderAchievementsList();
}

function removeAchievementCard(idx) {
  if (confirm('Delete this award achievement card?')) {
    const achs = collectAchievementsList();
    achs.splice(idx, 1);
    portfolioData.achievements = achs;
    markAsUnsaved();
    renderAchievementsList();
  }
}

function collectAchievementsList() {
  const cards = document.querySelectorAll('.ach-item-card');
  const arr = [];
  cards.forEach(card => {
    const title = card.querySelector('.ach-title-input').value.trim();
    const issuer = card.querySelector('.ach-issuer-input').value.trim();
    const date = card.querySelector('.ach-date-input').value.trim();
    const description = card.querySelector('.ach-desc-input').value.trim();
    const image = card.querySelector('.ach-image-input').value.trim();
    const link = card.querySelector('.ach-link-input').value.trim();

    if (title && issuer) {
      arr.push({ title, issuer, date, description, image, link });
    }
  });
  return arr;
}



// Inquiry messages popup details modal
const messageModal = document.getElementById('message-modal');
const messageModalContent = document.getElementById('message-modal-content');

function openMessageDetail(msgId) {
  const m = recentMessages.find(item => item.id === msgId);
  if (!m) return;

  const dateStr = new Date(m.date).toLocaleString();
  messageModalContent.innerHTML = `
    <div style="margin-bottom:15px; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:10px;">
      <div style="font-size:12px; color:var(--text-small);">Sender Name</div>
      <div style="font-size:16px; font-weight:700; color:var(--text-heading);">${m.name}</div>
    </div>
    <div style="margin-bottom:15px; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:10px;">
      <div style="font-size:12px; color:var(--text-small);">Email Address</div>
      <div style="font-size:14px; font-weight:600;"><a href="mailto:${m.email}" style="color:var(--primary);">${m.email}</a></div>
    </div>
    <div style="margin-bottom:15px; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:10px;">
      <div style="font-size:12px; color:var(--text-small);">Date & Time</div>
      <div style="font-size:14px; color:var(--text-paragraph);">${dateStr}</div>
    </div>
    <div style="margin-bottom:15px; border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:10px;">
      <div style="font-size:12px; color:var(--text-small);">Subject</div>
      <div style="font-size:15px; font-weight:600; color:var(--text-heading);">${m.subject}</div>
    </div>
    <div>
      <div style="font-size:12px; color:var(--text-small); margin-bottom:6px;">Message Inquiry</div>
      <div style="background:#FAFAFC; border:1px solid var(--border); border-radius:8px; padding:16px; font-size:14px; color:var(--text-paragraph); white-space:pre-wrap; line-height:1.6;">${m.message}</div>
    </div>
  `;

  // Hook actions
  document.getElementById('msg-modal-archive-btn').onclick = () => archiveMessage(msgId);
  document.getElementById('msg-modal-delete-btn').onclick = () => deleteMessage(msgId);

  // Set message status to read (if it was inbox) on server
  if (m.status === 'inbox') {
    fetch('/api/messages/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ id: msgId, action: 'archive' })
    }).then(() => fetchMessages());
  }

  messageModal.classList.add('show');
}

function closeMessageModal() {
  messageModal.classList.remove('show');
}

async function archiveMessage(msgId) {
  if (confirm('Archive this message inquiries?')) {
    await runMessageAction(msgId, 'archive');
  }
}

async function deleteMessage(msgId) {
  if (confirm('Delete this message permanently?')) {
    await runMessageAction(msgId, 'delete');
  }
}

async function runMessageAction(id, action) {
  try {
    const res = await fetch('/api/messages/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ id, action })
    });
    if (res.ok) {
      closeMessageModal();
      fetchMessages();
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadAnalyticsManagerSection() {
  const tbody = document.getElementById('analytics-table-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading logs...</td></tr>';

  try {
    const res = await fetch('/api/analytics', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const logs = await res.json();
      tbody.innerHTML = '';
      
      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No visitor logs found.</td></tr>';
        return;
      }

      logs.forEach(l => {
        const tr = document.createElement('tr');
        const dateStr = new Date(l.time).toLocaleString();
        
        tr.innerHTML = `
          <td>${dateStr}</td>
          <td><span class="tag-badge" style="padding:2px 8px; font-size:11px; ${l.type === 'visitor' ? 'background:rgba(124,92,255,0.1); color:var(--primary);' : 'background:rgba(59,130,246,0.1); color:#3B82F6;'}">${l.type}</span></td>
          <td style="font-family:var(--font-number); font-weight:600;">${l.ip}</td>
          <td><i class="fa-solid fa-earth-americas" style="color:var(--primary); margin-right:6px;"></i> ${l.country}</td>
          <td style="font-size:12px; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${l.userAgent}">${l.userAgent}</td>
          <td style="text-align: right;">
            <button class="action-row-btn delete" onclick="deleteAnalyticsLog('${l.time}')" title="Delete Log"><i class="fa-regular fa-trash-can"></i></button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error('Failed to load analytics logs:', err);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--danger);">Failed to load analytics logs.</td></tr>';
  }
}

async function deleteAnalyticsLog(time) {
  if (confirm('Delete this visitor log record permanently?')) {
    try {
      const res = await fetch('/api/analytics/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'delete', time })
      });
      if (res.ok) {
        loadAnalyticsManagerSection();
        renderDashboardOverview();
      }
    } catch {
      alert('Error deleting log.');
    }
  }
}

async function saveCompileDatabaseSilently() {
  collectFormInputs();
  try {
    const res = await fetch('/api/save-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(portfolioData)
    });
    if (res.ok) {
      clearUnsavedIndicator();
    }
  } catch (err) {
    console.error('Silent save error:', err);
  }
}

// Upload cert image via base64
async function uploadCertImage(fileInput, idx) {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const base64 = await convertFileToBase64(file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ fileName: file.name, fileType: 'projects', fileData: base64 })
    });
    const data = await res.json();
    if (res.ok && data.fileUrl) {
      const cards = document.querySelectorAll('.cert-item-card');
      if (cards[idx]) {
        cards[idx].querySelector('.cert-image-input').value = data.fileUrl;
        markAsUnsaved();
      }
    } else { alert(data.error || 'Image upload failed.'); }
  } catch { alert('Error uploading image.'); }
}

// Upload achievement image via base64
async function uploadAchImage(fileInput, idx) {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const base64 = await convertFileToBase64(file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ fileName: file.name, fileType: 'projects', fileData: base64 })
    });
    const data = await res.json();
    if (res.ok && data.fileUrl) {
      const cards = document.querySelectorAll('.ach-item-card');
      if (cards[idx]) {
        cards[idx].querySelector('.ach-image-input').value = data.fileUrl;
        markAsUnsaved();
      }
    } else { alert(data.error || 'Image upload failed.'); }
  } catch { alert('Error uploading image.'); }
}
