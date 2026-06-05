const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { EmbedBuilder } = require('discord.js');

module.exports = (client, getConfig, saveConfig) => {
    const app = express();
    const PORT = process.env.DASHBOARD_PORT || 4000;

    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(session({
        secret: 'kageplay-secret-key-123',
        resave: false,
        saveUninitialized: true
    }));

    // Authentication Middleware
    const checkAuth = (req, res, next) => {
        if (req.session.loggedIn) return next();
        res.redirect('/login');
    };

    // --- ROUTES ---

    app.get('/login', (req, res) => {
        res.render('login', { error: null });
    });

    app.post('/login', (req, res) => {
        const config = getConfig();
        if (req.body.password === config.adminPassword) {
            req.session.loggedIn = true;
            res.redirect('/');
        } else {
            res.render('login', { error: 'Invalid password' });
        }
    });

    app.get('/logout', (req, res) => {
        req.session.destroy();
        res.redirect('/login');
    });

    app.get('/', checkAuth, (req, res) => {
        const config = getConfig();
        // Pass basic bot stats
        const stats = {
            guilds: client.guilds.cache.size,
            users: client.users.cache.size,
            channels: client.channels.cache.size
        };
        res.render('dashboard', { config, stats });
    });

    app.post('/settings', checkAuth, (req, res) => {
        const config = getConfig();
        const updatedConfig = { ...config, ...req.body };
        saveConfig(updatedConfig);
        res.redirect('/?success=1');
    });

    app.get('/announce', checkAuth, (req, res) => {
        res.render('announce', { config: getConfig(), success: false });
    });

    app.post('/announce', checkAuth, async (req, res) => {
        const config = getConfig();
        const { title, description, image, channelId } = req.body;
        
        if (!channelId) {
            return res.render('announce', { config, success: 'Please provide a channel ID.' });
        }

        try {
            const channel = await client.channels.fetch(channelId);
            if (!channel) throw new Error("Channel not found");

            const embed = new EmbedBuilder()
                .setTitle(title || "Announcement")
                .setDescription(description || "")
                .setColor('#0099ff')
                .setTimestamp();

            if (image) embed.setImage(image);

            await channel.send({ embeds: [embed] });
            res.render('announce', { config, success: 'Announcement posted successfully!' });
        } catch (err) {
            res.render('announce', { config, success: `Error: ${err.message}` });
        }
    });

    app.get('/env', checkAuth, (req, res) => {
        const envPath = path.join(__dirname, '.env');
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }
        res.render('env', { envContent, success: false });
    });

    app.post('/env', checkAuth, (req, res) => {
        const envPath = path.join(__dirname, '.env');
        fs.writeFileSync(envPath, req.body.envContent || '');
        res.render('env', { envContent: req.body.envContent, success: 'Environment variables saved successfully! Please restart the bot for changes to take effect.' });
    });

    app.listen(PORT, () => {
        console.log(`Web Dashboard is running at http://localhost:${PORT}`);
    });
};
