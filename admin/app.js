const API_BASE = window.location.origin + '/api/admin';
let adminToken = localStorage.getItem('admin_token');
let refreshTimer = null;

async function adminLogin() {
  const username = document.getElementById('admin-user').value.trim();
  const password = document.getElementById('admin-pass').value.trim();
  const errorEl = document.getElementById('login-error');
  if (!username || !password) { errorEl.textContent = 'Fill in all fields'; return; }
  try {
    const res = await fetch(API_BASE + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || 'Login failed'; return; }
    adminToken = data.token;
    localStorage.setItem('admin_token', adminToken);
    document.getElementById('admin-user-display').textContent = 'Admin: ' + data.username;
    showAdmin();
    loadData();
    startAutoRefresh();
  } catch (err) { errorEl.textContent = 'Connection error'; }
}

function adminLogout() {
  adminToken = null;
  localStorage.removeItem('admin_token');
  stopAutoRefresh();
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('admin-screen').style.display = 'none';
}

function showAdmin() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-screen').style.display = 'block';
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(loadData, 3000);
}

function stopAutoRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

async function apiCall(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  return res.json();
}

async function loadData() {
  try {
    const stats = await apiCall('/stats');
    document.getElementById('stat-users').textContent = stats.totalUsers || 0;
    document.getElementById('stat-games').textContent = stats.totalGames || 0;
    document.getElementById('stat-guesses').textContent = stats.totalGuesses || 0;
    document.getElementById('stat-points').textContent = stats.totalPoints || 0;

    const leaderboard = await apiCall('/leaderboard');
    document.getElementById('leaderboard-body').innerHTML = leaderboard.map((u, i) =>
      `<tr><td>${i + 1}</td><td>${u.username}</td><td>${u.level1_wins}</td><td>${u.level2_wins}</td><td>${u.level3_wins}</td><td><strong>${u.total_points}</strong></td></tr>`
    ).join('');

    const games = await apiCall('/games');
    const activeL1 = games.find(g => g.level === 1 && g.active);
    if (activeL1) {
      document.getElementById('active-code').textContent = activeL1.code;
      document.getElementById('active-code-box').style.display = 'block';
    } else {
      document.getElementById('active-code-box').style.display = 'none';
    }

    document.getElementById('games-body').innerHTML = games.map(g => {
      const isActive = g.active ? true : false;
      return `<tr style="${isActive ? 'background:#00BCD410;border-left:3px solid #00E676' : ''}">
        <td>${g.id}</td>
        <td>Level ${g.level}</td>
        <td style="font-family:monospace;color:#00E676;font-weight:${isActive ? 'bold' : 'normal'}">${g.level === 1 ? g.code : g.code.slice(0, 10) + '...'}</td>
        <td>${isActive ? '<span style="color:#00E676;font-weight:bold">ACTIVE</span>' : '<span style="color:#FF5252">Inactive</span>'}</td>
        <td style="color:#8899AA;font-size:12px">${g.generated_at || '-'}</td>
      </tr>`;
    }).join('');

    const activity = await apiCall('/activity');
    document.getElementById('activity-body').innerHTML = activity.map(a =>
      `<tr><td>${a.username}</td><td>Level ${a.level}</td><td style="font-family:monospace">${a.guess}</td><td>${a.correct ? '<span style="color:#00E676">Yes</span>' : '<span style="color:#FF5252">No</span>'}</td><td style="color:#8899AA;font-size:12px">${a.timestamp || '-'}</td></tr>`
    ).join('');
  } catch (err) { console.error('Failed to load data', err); }
}

async function exportData() {
  try {
    const data = await apiCall('/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'code_breaker_export_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) { console.error('Export failed', err); }
}

function refreshData() { loadData(); }

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
  document.querySelector(`.tab[onclick*="${tab}"]`).classList.add('active');
  document.getElementById('tab-' + tab).style.display = 'block';
}

if (adminToken) {
  document.getElementById('admin-user-display').textContent = 'Admin';
  showAdmin();
  loadData();
  startAutoRefresh();
}
