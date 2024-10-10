const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs').promises;
const bodyParser = require('body-parser');
const axios = require('axios');
const Replicate = require('replicate');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const savedDir = path.join(__dirname, 'saved');
fs.mkdir(savedDir, { recursive: true }).catch(console.error);

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json({ limit: '50mb' }));

app.get('/api/keys', (req, res) => {
    res.json({
        openaiKey: process.env.OPENAI_API_KEY,
        replicateKey: process.env.REPLICATE_API_TOKEN,
    });
});

app.get('/get-files', (req, res) => {
    const tablesDir = path.join(__dirname, 'public', 'tools', 'tables');
    
    fs.readdir(tablesDir)
        .then(files => {
            const txtFiles = files.filter(file => file.endsWith('.txt')).map(file => path.basename(file, '.txt'));
            res.json(txtFiles);
        })
        .catch(err => {
            res.status(500).json({ error: 'Unable to read directory' });
        });
});

app.get('/get-random-item', (req, res) => {
    const fileName = req.query.file;
    if (!fileName) {
        return res.status(400).send('File name is required');
    }
    
    const filePath = path.join(__dirname, 'public', 'tools', 'tables', `${fileName}.txt`);
    
    fs.readFile(filePath, 'utf8')
        .then(data => {
            const jsonData = JSON.parse(data);
            const items = jsonData.items;
            if (!items || items.length === 0) {
                return res.status(404).send('No items found in the file');
            }
            
            const randomItem = items[Math.floor(Math.random() * items.length)];
            res.json({ item: randomItem });
        })
        .catch(err => {
            res.status(500).send('Error reading or parsing file');
        });
});

app.post('/generate-image', async (req, res) => {
  const { prompt } = req.body;

  try {
    const output = await replicate.run("black-forest-labs/flux-schnell", {
      input: { prompt },
    });
    res.json({ imageUrl: output[0] });
  } catch (error) {
    console.error('Error generating image with Replicate:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/save-npc', async (req, res) => {
    try {
        const npc = req.body;
        const date = new Date().toISOString().split('T')[0];
        const safeName = npc.stats.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const npcDir = path.join(__dirname, 'saved', `npc_${safeName}_${date}`);
        
        await fs.mkdir(npcDir, { recursive: true });

        await fs.writeFile(path.join(npcDir, 'data.json'), JSON.stringify(npc, null, 2));

        if (npc.imageUrl) {
            try {
                const imageResponse = await axios.get(npc.imageUrl, { responseType: 'arraybuffer' });
                const imageBuffer = Buffer.from(imageResponse.data, 'binary');
                await fs.writeFile(path.join(npcDir, 'image.png'), imageBuffer);
                
                npc.imageUrl = `saved/npc_${safeName}_${date}/image.png`;
                await fs.writeFile(path.join(npcDir, 'data.json'), JSON.stringify(npc, null, 2));
            } catch (imageError) {
                console.error('Error saving image:', imageError);
            }
        }

        res.json({ success: true, id: `npc_${safeName}_${date}` });
    } catch (error) {
        console.error('Error saving NPC:', error);
        res.status(500).json({ error: 'Failed to save NPC', details: error.message });
    }
});

app.get('/api/saved-npcs', async (req, res) => {
    try {
        const savedDir = path.join(__dirname, 'saved');
        const dirs = await fs.readdir(savedDir);
        const npcs = await Promise.all(dirs.map(async (dir) => {
            const dataPath = path.join(savedDir, dir, 'data.json');
            try {
                const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
                return {
                    id: dir,
                    name: data.stats.name,
                    imagePath: data.imageUrl && data.imageUrl.startsWith('saved') ? `/${data.imageUrl}` : `/saved/${dir}/image.png`
                };
            } catch (error) {
                console.error(`Error reading NPC data from ${dataPath}:`, error);
                return null;
            }
        }));
        res.json(npcs.filter(npc => npc !== null));
    } catch (error) {
        console.error('Error retrieving NPCs:', error);
        res.status(500).json({ error: 'Failed to retrieve NPCs', details: error.message });
    }
});

app.get('/api/npc/:id', async (req, res) => {
    try {
        const npcId = req.params.id;
        const npcPath = path.join(__dirname, 'saved', npcId, 'data.json');
        const npcData = await fs.readFile(npcPath, 'utf8');
        const npc = JSON.parse(npcData);
        res.json(npc);
    } catch (error) {
        console.error('Error retrieving NPC:', error);
        res.status(404).json({ error: 'NPC not found' });
    }
});

app.delete('/api/npc/:id', async (req, res) => {
    try {
        const npcId = req.params.id;
        const npcDir = path.join(__dirname, 'saved', npcId);
        await fs.rm(npcDir, { recursive: true, force: true });
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting NPC:', error);
        res.status(500).json({ error: 'Failed to delete NPC' });
    }
});

app.post('/api/save-notes', async (req, res) => {
    try {
        const notes = req.body;
        const notesPath = path.join(__dirname, 'saved', 'notes.json');
        await fs.writeFile(notesPath, JSON.stringify(notes, null, 2));
        res.json({ success: true, message: 'Notes saved successfully' });
    } catch (error) {
        console.error('Error saving notes:', error);
        res.status(500).json({ error: 'Failed to save notes', details: error.message });
    }
});

app.get('/api/get-notes', async (req, res) => {
    try {
        const notesPath = path.join(__dirname, 'saved', 'notes.json');
        const notesData = await fs.readFile(notesPath, 'utf8');
        const notes = JSON.parse(notesData);
        res.json(notes);
    } catch (error) {
        console.error('Error retrieving notes:', error);
        res.status(500).json({ error: 'Failed to retrieve notes', details: error.message });
    }
});

app.use('/saved', express.static(path.join(__dirname, 'saved')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});