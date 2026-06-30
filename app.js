// Override window.fetch to support running from file:// protocol
const originalFetch = window.fetch;
window.fetch = function(url, options) {
  const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
  if (typeof url === 'string' && url.startsWith('/api/')) {
    url = apiBase + url;
  }
  return originalFetch(url, options);
};

document.addEventListener('DOMContentLoaded', () => {
  // Check if server is running locally to display the quick admin link
  const isLocal = ['localhost', '127.0.0.1', ''].includes(window.location.hostname) || window.location.protocol === 'file:';
  const quickLink = document.getElementById('admin-quick-link');
  if (isLocal && quickLink) {
    quickLink.style.display = 'inline-flex';
  }

  // Report public hit page visit
  const visitedKey = 'portfolio_visited_session';
  const hasVisited = sessionStorage.getItem(visitedKey);
  const hitType = hasVisited ? 'view' : 'visitor';
  sessionStorage.setItem(visitedKey, 'true');

  fetch('/api/analytics/hit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: hitType })
  }).catch(() => {});

  // Load dataset
  const dataUrl = isLocal && window.location.protocol !== 'file:' ? '/api/data' : 'data.json';
  
  fetch(dataUrl)
    .then(res => {
      if (!res.ok) throw new Error('Data fetch failed');
      return res.json();
    })
    .then(data => {
      populatePortfolio(data);
      initTypingAnimation(data.personal || {}, data.animation || {});
    })
    .catch(err => {
      console.error('Failed to load portfolio database:', err);
      document.getElementById('hero-name').textContent = 'Atul Pandey (Offline)';
    });

  // Theme Toggler
  const themeBtn = document.getElementById('theme-toggle');
  let currentTheme = localStorage.getItem('theme') || 'light';
  document.body.classList.toggle('dark-mode', currentTheme === 'dark');
  updateThemeIcon();

  themeBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.body.classList.toggle('dark-mode', currentTheme === 'dark');
    localStorage.setItem('theme', currentTheme);
    updateThemeIcon();
  });

  function updateThemeIcon() {
    const icon = themeBtn.querySelector('i');
    if (document.body.classList.contains('dark-mode')) {
      icon.className = 'fa-solid fa-sun';
    } else {
      icon.className = 'fa-regular fa-moon';
    }
  }

  // Contact Form Submission
  const contactForm = document.getElementById('portfolio-contact-form');
  const formStatus = document.getElementById('form-status');

  if (contactForm && formStatus) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const name = document.getElementById('form-name').value.trim();
      const email = document.getElementById('form-email').value.trim();
      const subject = document.getElementById('form-subject').value.trim();
      const message = document.getElementById('form-message').value.trim();

      formStatus.style.display = 'block';
      formStatus.className = 'form-status';
      formStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting message...';

      try {
        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, subject, message })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          formStatus.className = 'form-status success';
          formStatus.style.color = 'var(--success)';
          formStatus.innerHTML = `🌟 Thank you, ${name}! Your inquiry has been sent successfully.`;
          contactForm.reset();
        } else {
          formStatus.className = 'form-status error';
          formStatus.style.color = 'var(--danger)';
          formStatus.innerHTML = `❌ Error: ${data.error || 'Failed to submit.'}`;
        }
      } catch {
        formStatus.className = 'form-status error';
        formStatus.style.color = 'var(--danger)';
        formStatus.innerHTML = `❌ Connection Error: Make sure local server is running.`;
      }

      setTimeout(() => {
        formStatus.style.display = 'none';
      }, 6000);
    });
  }
});

// Populate index elements
function populatePortfolio(data) {
  if (!data) return;

  const p = data.personal || {};

  // Logo & Header
  document.getElementById('nav-brand').querySelector('span').textContent = p.name || 'Atul Pandey';
  document.getElementById('footer-name').textContent = p.name || 'Atul Pandey';
  document.getElementById('footer-year').textContent = new Date().getFullYear();

  // Hero section details
  document.getElementById('hero-name').textContent = p.name || '';
  document.getElementById('hero-title').textContent = p.title || '';
  document.getElementById('hero-bio').textContent = p.bio || '';
  if (document.getElementById('hero-prefix') && p.heroPrefix) {
    document.getElementById('hero-prefix').textContent = p.heroPrefix;
  }

  if (p.image && p.image !== 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png') {
    document.getElementById('hero-avatar').src = p.image;
  }

  // Floating stats
  document.getElementById('stat-years').textContent = p.yearsOfLearning || '2+';
  document.getElementById('stat-projects').textContent = p.projectsCompleted || '15+';

  // Social Links
  const github = document.getElementById('social-github');
  const linkedin = document.getElementById('social-linkedin');
  const twitter = document.getElementById('social-twitter');
  const email = document.getElementById('social-email');
  const downloadCV = document.getElementById('nav-download-cv');

  if (p.github) github.href = p.github; else github.style.display = 'none';
  if (p.linkedin) linkedin.href = p.linkedin; else linkedin.style.display = 'none';
  if (p.twitter) twitter.href = p.twitter; else twitter.style.display = 'none';
  if (p.email) email.href = `mailto:${p.email}`; else email.style.display = 'none';
  
  if (p.resumeUrl && p.resumeUrl !== '#') {
    downloadCV.href = p.resumeUrl;
    downloadCV.style.display = 'inline-flex';
  } else {
    downloadCV.style.display = 'none';
  }

  // About Card details
  document.getElementById('about-bio').textContent = p.summary || p.bio || '';
  document.getElementById('info-location').textContent = p.location || 'India';
  document.getElementById('info-education').textContent = p.educationBrief || 'B.Com (Hons)';
  document.getElementById('info-email').textContent = p.email || '';
  document.getElementById('info-status').textContent = p.status || 'Available for Internships';

  // Metrics Card blocks
  document.getElementById('box-projects').textContent = p.projectsCompleted || '15+';
  document.getElementById('box-years').textContent = p.yearsOfLearning || '2+';
  document.getElementById('box-technologies').textContent = p.technologiesMastered || '5+';
  document.getElementById('box-dsa').textContent = p.dsaProblemsSolved || '100+';

  // Contact Details
  document.getElementById('contact-email').textContent = p.email || '';
  document.getElementById('contact-email').href = `mailto:${p.email}`;
  document.getElementById('contact-location').textContent = p.location || 'India';

  // Populate Skills list
  populateSkills(data.skills || []);

  // Populate Projects
  populateProjects(data.projects || []);
  populateCertifications(data.certificates || []);
  populateAchievements(data.achievements || []);

  // Populate Timelines
  populateTimeline('experience-timeline', data.experience || []);
  populateTimeline('education-timeline', data.education || []);

  // AUTO-CALCULATE metrics from real data
  const liveProjectCount = (data.projects || []).filter(p => p.status === 'Live' || p.status === 'Completed').length;
  const liveTechCount = (data.skills || []).reduce((sum, group) => sum + (group.list || []).length, 0);

  const projEl = document.getElementById('box-projects');
  const techEl = document.getElementById('box-technologies');
  if (projEl) projEl.textContent = liveProjectCount > 0 ? liveProjectCount + '+' : (p.projectsCompleted || '0');
  if (techEl) techEl.textContent = liveTechCount > 0 ? liveTechCount + '+' : (p.technologiesMastered || '0');

  // Hero stat cards reflect same project count
  const statProj = document.getElementById('stat-projects');
  if (statProj) statProj.textContent = liveProjectCount > 0 ? liveProjectCount + '+' : (p.projectsCompleted || '0');

  // Load LeetCode live stats if username set
  const lcUsername = p.leetcodeUsername;
  if (lcUsername) {
    const lcCard = document.getElementById('leetcode-card');
    if (lcCard) lcCard.style.display = 'block';
    const lcLink = document.getElementById('leetcode-profile-link');
    if (lcLink) lcLink.href = `https://leetcode.com/u/${lcUsername}/`;
    const lcUsernameEl = document.getElementById('leetcode-username-display');
    if (lcUsernameEl) lcUsernameEl.textContent = lcUsername;
    loadLeetCodeStats(lcUsername);
  }
}

function populateSkills(skills) {
  const wrapper = document.getElementById('skills-matrix-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = '';

  skills.forEach(group => {
    const div = document.createElement('div');
    div.className = 'skill-row-group';
    
    div.innerHTML = `
      <div class="skill-group-label">${group.category}</div>
      <div class="skill-badges-container">
        ${group.list.map(skill => `<span class="skill-badge-card">${skill}</span>`).join('')}
      </div>
    `;
    wrapper.appendChild(div);
  });
}

function populateProjects(projects) {
  const grid = document.getElementById('projects-board-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Filter only Live and Completed, sorted by custom order
  const active = projects
    .filter(p => p.status === 'Live' || p.status === 'Completed')
    .sort((a, b) => (a.order || 99) - (b.order || 99));

  if (active.length === 0) {
    grid.innerHTML = '<p class="text-center w-full">No featured projects found.</p>';
    return;
  }

  active.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card project-card-layout';
    
    let thumbHTML = `<i class="fa-solid fa-laptop-code"></i>`;
    if (p.image) {
      thumbHTML = `<img src="${p.image}" alt="${p.title}">`;
    }

    const mode = p.linkMode || 'both';
    let ctaHTML = '';
    
    if ((mode === 'both' || mode === 'demo') && p.demoUrl) {
      ctaHTML += `
        <a href="${p.demoUrl}" target="_blank" class="proj-link-item">
          <span>Live Demo</span> <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 12px;"></i>
        </a>`;
    } else if (mode === 'video') {
      const vidUrl = p.videoUrl || '';
      if (vidUrl) {
        ctaHTML += `
          <a href="javascript:void(0)" onclick="playDemoVideo('${p.title.replace(/'/g, "\\'")}', '${vidUrl}')" class="proj-link-item" style="color: var(--primary);">
            <span>Watch Video</span> <i class="fa-solid fa-play" style="font-size: 12px;"></i>
          </a>`;
      }
    }

    let githubHTML = '';
    if ((mode === 'both' || mode === 'code' || mode === 'video') && p.githubUrl) {
      githubHTML += `
        <a href="${p.githubUrl}" target="_blank" class="proj-github-btn" title="GitHub Code">
          <i class="fa-brands fa-github"></i>
        </a>`;
    }

    card.innerHTML = `
      <div class="proj-hero-image">${thumbHTML}</div>
      <h3 class="proj-card-title">${p.title}</h3>
      <p class="proj-card-desc">${p.shortDescription || p.description}</p>
      <div class="proj-tags-list">
        ${(p.tags || []).map(t => `<span class="proj-tag-badge">${t}</span>`).join('')}
      </div>
      <div class="proj-actions-row">
        ${ctaHTML}
        ${githubHTML}
      </div>
    `;
    grid.appendChild(card);
  });
}

function initTypingAnimation(personal, animSettings) {
  const nameEl = document.getElementById('hero-name');
  if (!nameEl) return;

  const originalName = personal.name || 'Atul Pandey';
  const anim = animSettings || {};

  // Use saved taglines or defaults, always prepend the name as first item
  let taglines = (anim.taglines && anim.taglines.length > 0)
    ? [originalName, ...anim.taglines]
    : [originalName, 'a Software Engineer', 'a Full Stack Developer', 'an ML Specialist', 'a Problem Solver'];

  const TYPE_SPEED  = anim.typeSpeed  || 150;
  const ERASE_SPEED = anim.eraseSpeed || 80;
  const PAUSE_END   = anim.pauseEnd   || 1500;
  const PAUSE_NEXT  = anim.pauseNext  || 500;

  let wordIdx = 0;
  let charIdx = 0;
  let isDeleting = false;
  let delay = TYPE_SPEED;

  function type() {
    const currentWord = taglines[wordIdx];
    if (isDeleting) {
      nameEl.textContent = currentWord.substring(0, charIdx - 1);
      charIdx--;
      delay = ERASE_SPEED;
    } else {
      nameEl.textContent = currentWord.substring(0, charIdx + 1);
      charIdx++;
      delay = TYPE_SPEED;
    }

    if (!isDeleting && charIdx === currentWord.length) {
      isDeleting = true;
      delay = PAUSE_END;
    } else if (isDeleting && charIdx === 0) {
      isDeleting = false;
      wordIdx = (wordIdx + 1) % taglines.length;
      delay = PAUSE_NEXT;
    }

    setTimeout(type, delay);
  }

  type();
}

function populateTimeline(id, items) {
  const container = document.getElementById(id);
  if (!container) return;
  container.innerHTML = '';

  if (!items || items.length === 0) {
    container.innerHTML = '<p style="font-size:14px; color:#9CA3AF; padding: 12px 0;">No entries added yet.</p>';
    return;
  }

  const COLORS = ['color-0', 'color-1', 'color-2', 'color-3', 'color-4', 'color-5'];

  items.forEach((item, idx) => {
    const div = document.createElement('div');
    const colorClass = COLORS[idx % COLORS.length];
    div.className = `timeline-item ${colorClass}`;

    const role = item.role || item.degree || '';
    const company = item.company || item.institution || '';

    // Build skill tags if provided
    const skillTags = (item.skills || item.tags || []);
    const tagsHTML = skillTags.length > 0
      ? `<div class="timeline-tags">${skillTags.map(t => `<span class="timeline-tag">${t}</span>`).join('')}</div>`
      : '';

    div.innerHTML = `
      <div class="timeline-node"></div>
      <div class="timeline-date">
        <i class="fa-regular fa-calendar"></i>${item.duration || ''}
      </div>
      <div class="timeline-title">${role}</div>
      <div class="timeline-subtitle">${company}</div>
      ${item.description ? `<p class="timeline-desc">${item.description}</p>` : ''}
      ${tagsHTML}
    `;
    container.appendChild(div);
  });
}

function playDemoVideo(title, videoUrl) {
  const modal = document.getElementById('video-lightbox-modal');
  const body = document.getElementById('video-modal-body');
  document.getElementById('video-modal-title').textContent = `${title} - Demo Video`;
  
  if (!videoUrl) {
    body.innerHTML = '<p style="color:#9CA3AF;">No video source path provided for this project.</p>';
  } else if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
    let videoId = '';
    if (videoUrl.includes('v=')) {
      videoId = videoUrl.split('v=')[1].split('&')[0];
    } else {
      videoId = videoUrl.split('/').pop();
    }
    body.innerHTML = `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${videoId}?autoplay=1" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="border: none;"></iframe>`;
  } else {
    body.innerHTML = `<video src="${videoUrl}" controls autoplay style="width: 100%; height: 100%; object-fit: contain;"></video>`;
  }
  
  modal.style.display = 'flex';
}

function closeVideoLightbox() {
  const modal = document.getElementById('video-lightbox-modal');
  const body = document.getElementById('video-modal-body');
  body.innerHTML = '';
  modal.style.display = 'none';
}

// ================================================
//  LEETCODE LIVE STATS WIDGET
// ================================================

async function loadLeetCodeStats(username) {
  // Use stored username if not passed
  if (!username) {
    const lcEl = document.getElementById('leetcode-username-display');
    username = lcEl ? lcEl.textContent : null;
  }
  if (!username) return;

  const loading = document.getElementById('lc-loading');
  const refreshLabel = document.getElementById('lc-refresh-label');
  if (loading) loading.style.display = 'flex';
  if (refreshLabel) refreshLabel.textContent = 'Refreshing...';

  try {
    const res = await fetch(`/api/leetcode/${username}`);
    if (!res.ok) throw new Error('Fetch failed');
    const data = await res.json();

    const user = data.matchedUser;
    const contest = data.userContestRanking;

    if (!user) throw new Error('User not found');

    // Problem counts
    const stats = user.submitStats?.acSubmissionNum || [];
    const total  = (stats.find(s => s.difficulty === 'All')?.count)   || 0;
    const easy   = (stats.find(s => s.difficulty === 'Easy')?.count)  || 0;
    const medium = (stats.find(s => s.difficulty === 'Medium')?.count)|| 0;
    const hard   = (stats.find(s => s.difficulty === 'Hard')?.count)  || 0;

    // Update metric card DSA count
    const dsaEl = document.getElementById('box-dsa');
    if (dsaEl) dsaEl.textContent = total + '+';

    // Widget values
    setText('lc-total', total);
    setText('lc-easy', easy);
    setText('lc-medium', medium);
    setText('lc-hard', hard);

    // Progress bars (cap at 100%)
    setBar('lc-bar-easy',   easy,   800);
    setBar('lc-bar-medium', medium, 1600);
    setBar('lc-bar-hard',   hard,   700);

    // Profile ranking
    const ranking = user.profile?.ranking;
    if (ranking) setText('lc-global-rank', ranking.toLocaleString());

    // Contest rating
    if (contest && contest.rating) {
      const ratingBadge = document.getElementById('leetcode-rating-badge');
      if (ratingBadge) ratingBadge.style.display = 'flex';
      setText('leetcode-contest-rating', Math.round(contest.rating));
      setText('lc-contests', contest.attendedContestsCount || 0);
      if (contest.globalRanking) setText('lc-global-rank', contest.globalRanking.toLocaleString());
    }

    if (loading) loading.style.display = 'none';
    if (refreshLabel) refreshLabel.textContent = 'Refresh';

  } catch (err) {
    console.warn('LeetCode stats fetch failed:', err.message);
    if (loading) loading.style.display = 'none';
    if (refreshLabel) refreshLabel.textContent = 'Retry';
    // Show error state in widget
    ['lc-total','lc-easy','lc-medium','lc-hard'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.textContent === '—') el.textContent = 'N/A';
    });
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setBar(id, count, max) {
  const el = document.getElementById(id);
  if (el) {
    const pct = Math.min(100, Math.round((count / max) * 100));
    el.style.width = pct + '%';
  }
}

// Populate Certifications
function populateCertifications(certs) {
  const grid = document.getElementById('certs-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (certs.length === 0) {
    grid.innerHTML = '<p class="text-center w-full">No certifications added yet.</p>';
    return;
  }
  certs.forEach(c => {
    const card = document.createElement('div');
    card.className = 'cert-card';
    let iconHTML = '<i class="fa-solid fa-certificate"></i>';
    if (c.image) iconHTML = `<img src="${c.image}" alt="${c.name}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`;
    let linkHTML = '';
    if (c.credentialUrl && c.credentialUrl !== '#') {
      linkHTML = `<a href="${c.credentialUrl}" target="_blank" class="cert-card-link"><i class="fa-solid fa-arrow-up-right-from-square" style="font-size:11px;"></i> View Credential</a>`;
    }
    card.innerHTML = `
      <div class="cert-card-header">
        <div class="cert-card-icon">${iconHTML}</div>
        <div class="cert-card-body">
          <h3>${c.name}</h3>
          <span class="cert-org">${c.organization || ''}</span>
        </div>
      </div>
      <div class="cert-card-meta">
        <span class="cert-card-date"><i class="fa-regular fa-calendar"></i> ${c.date || ''}</span>
        ${linkHTML}
      </div>
    `;
    grid.appendChild(card);
  });
}

// Populate Achievements
function populateAchievements(achs) {
  const grid = document.getElementById('achievements-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (achs.length === 0) {
    grid.innerHTML = '<p class="text-center w-full">No achievements added yet.</p>';
    return;
  }
  achs.forEach(a => {
    const card = document.createElement('div');
    card.className = 'ach-card';
    let iconHTML = '<i class="fa-solid fa-trophy"></i>';
    if (a.image) iconHTML = `<img src="${a.image}" alt="${a.title}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`;
    let descHTML = '';
    if (a.description) descHTML = `<p class="ach-card-desc">${a.description}</p>`;
    let linkHTML = '';
    if (a.link && a.link !== '#') {
      linkHTML = `<a href="${a.link}" target="_blank" class="ach-card-link"><i class="fa-solid fa-arrow-up-right-from-square" style="font-size:11px;"></i> View</a>`;
    }
    card.innerHTML = `
      <div class="ach-card-header">
        <div class="ach-card-icon">${iconHTML}</div>
        <div class="ach-card-body">
          <h3>${a.title}</h3>
          <span class="ach-issuer">${a.issuer || ''}</span>
        </div>
      </div>
      ${descHTML}
      <div class="ach-card-meta">
        <span class="ach-card-date"><i class="fa-regular fa-calendar"></i> ${a.date || ''}</span>
        ${linkHTML}
      </div>
    `;
    grid.appendChild(card);
  });
}
