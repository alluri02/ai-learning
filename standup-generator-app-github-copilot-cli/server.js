const express = require('express');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

function getDateString(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCommits(repoPath, since, until, authorEmail) {
  try {
    const args = ['-C', repoPath, 'log', `--since=${since} 00:00:00`, `--until=${until} 23:59:59`, '--pretty=format:%s\t%an'];
    if (authorEmail) {
      args.push(`--author=${authorEmail}`);
    }
    const output = execFileSync('git', args, { encoding: 'utf-8', timeout: 10000 });
    if (!output.trim()) return [];
    return output.trim().split('\n').map(line => {
      const [message, author] = line.split('\t');
      return { message, author };
    });
  } catch (error) {
    console.error('Error fetching commits:', error.message);
    throw error;
  }
}

function formatDateLabel(dateStr, daysAgo) {
  if (daysAgo === 1) return 'Yesterday';
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

app.post('/api/standup', (req, res) => {
  const { repoPath, repoPaths, authorEmail } = req.body;

  // Support both legacy single repoPath and new repoPaths array
  let paths = [];
  if (Array.isArray(repoPaths) && repoPaths.length > 0) {
    paths = repoPaths.map(p => p.trim()).filter(Boolean);
  } else if (typeof repoPath === 'string' && repoPath.trim()) {
    paths = [repoPath.trim()];
  }

  if (paths.length === 0) {
    return res.status(400).json({ error: 'At least one repository path is required' });
  }

  const email = (typeof authorEmail === 'string' && authorEmail.trim()) ? authorEmail.trim() : null;
  const daysBack = 1;
  const today = getDateString(0);

  // Build day slots: oldest first (daysBack days ago → yesterday)
  const daySlots = [];
  for (let i = daysBack; i >= 1; i--) {
    const dateStr = getDateString(i);
    daySlots.push({ daysAgo: i, date: dateStr, label: formatDateLabel(dateStr, i) });
  }

  const repos = paths.map(p => {
    let resolvedPath;
    try {
      resolvedPath = fs.realpathSync(p);
    } catch {
      return { name: path.basename(p), path: p, days: [], today: [], error: 'Path does not exist or cannot be accessed' };
    }

    const gitDir = path.join(resolvedPath, '.git');
    if (!fs.existsSync(gitDir)) {
      return { name: path.basename(p), path: p, days: [], today: [], error: 'Not a git repository' };
    }

    try {
      const todayCommits = getCommits(resolvedPath, today, today, email);
      const perDay = daySlots.map(slot => ({
        date: slot.date,
        label: slot.label,
        commits: getCommits(resolvedPath, slot.date, slot.date, email)
      }));
      return { name: path.basename(resolvedPath), path: p, days: perDay, today: todayCommits, error: null };
    } catch (err) {
      return { name: path.basename(p), path: p, days: [], today: [], error: err.message };
    }
  });

  res.json({ repos });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
