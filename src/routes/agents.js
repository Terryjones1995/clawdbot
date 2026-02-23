const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const AGENTS_DIR = path.join(__dirname, '../../openclaw/agents');

function ensureDir() {
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
}

function listAgents() {
  ensureDir();
  return fs.readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, f), 'utf8')));
}

function getAgent(id) {
  const file = path.join(AGENTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveAgent(agent) {
  ensureDir();
  fs.writeFileSync(path.join(AGENTS_DIR, `${agent.id}.json`), JSON.stringify(agent, null, 2));
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
}

// GET /api/agents
router.get('/', (req, res) => {
  const agents = listAgents().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(agents);
});

// GET /api/agents/:id
router.get('/:id', (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found.' });
  res.json(agent);
});

// POST /api/agents
router.post('/', (req, res) => {
  const { name, description, model, systemPrompt } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });

  ensureDir();
  const baseSlug = slugify(name.trim());
  let id = baseSlug;
  let i = 2;
  while (fs.existsSync(path.join(AGENTS_DIR, `${id}.json`))) {
    id = `${baseSlug}-${i++}`;
  }

  const agent = {
    id,
    name: name.trim(),
    description: (description || '').trim(),
    model: model || 'claude-sonnet-4-6',
    systemPrompt: (systemPrompt || '').trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveAgent(agent);
  res.status(201).json(agent);
});

// PUT /api/agents/:id
router.put('/:id', (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found.' });

  const { name, description, model, systemPrompt } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'Name cannot be empty.' });

  const updated = {
    ...agent,
    name: name !== undefined ? name.trim() : agent.name,
    description: description !== undefined ? description.trim() : agent.description,
    model: model || agent.model,
    systemPrompt: systemPrompt !== undefined ? systemPrompt.trim() : agent.systemPrompt,
    updatedAt: new Date().toISOString(),
  };

  saveAgent(updated);
  res.json(updated);
});

// DELETE /api/agents/:id
router.delete('/:id', (req, res) => {
  const file = path.join(AGENTS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Agent not found.' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

module.exports = router;
