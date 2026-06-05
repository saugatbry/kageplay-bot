const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Helper to read/write config
const getConfig = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const saveConfig = (data) => fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(data, null, 2));

// --- ANIME NOTIFIER ---
const API_URL = process.env.API_URL || "http://localhost:3000/api/newadded";
const STATE_FILE = path.join(__dirname, 'last_seen.json');
let lastSeenId = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).lastSeenId : null;

async function checkForNewEpisodes() {
    const config = getConfig();
    if (!config.announcementChannel) return;

    try {
        const channel = await client.channels.fetch(config.announcementChannel).catch(() => null);
        if (!channel) return;

        const response = await axios.get(API_URL);
        if (!response.data.success || !response.data.results) return;

        const latestEpisodes = response.data.results;
        const newEpisodes = [];
        for (const ep of latestEpisodes) {
            const uniqueId = `${ep.anime_id}-s${ep.season}-e${ep.episode}`;
            if (uniqueId === lastSeenId) break;
            newEpisodes.unshift(ep);
        }

        if (newEpisodes.length > 0) {
            for (const ep of newEpisodes) {
                const embed = new EmbedBuilder()
                    .setTitle(`New Episode Released: ${ep.title}`)
                    .setDescription(`**Season:** ${ep.season} | **Episode:** ${ep.episode}`)
                    .setColor('#FF4500')
                    .setImage(ep.poster || null)
                    .setFooter({ text: 'KagePlay Anime Bot' })
                    .setTimestamp();

                const pingText = config.pingRole ? `<@&${config.pingRole}>` : '';
                await channel.send({ content: `${pingText} A new episode is out!`, embeds: [embed] });
                
                lastSeenId = `${ep.anime_id}-s${ep.season}-e${ep.episode}`;
                fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSeenId }));
            }
        }
    } catch (err) {
        console.error("Anime Checker Error:", err.message);
    }
}

// --- DISCORD EVENTS ---

client.once('ready', () => {
    console.log(`Bot Logged in as ${client.user.tag}!`);
    setInterval(checkForNewEpisodes, 5 * 60 * 1000);
});

// Welcome Message
client.on('guildMemberAdd', async (member) => {
    const config = getConfig();
    if (config.welcomeChannel && config.welcomeMessage) {
        const channel = member.guild.channels.cache.get(config.welcomeChannel);
        if (channel) {
            const msg = config.welcomeMessage.replace('{user}', `<@${member.id}>`);
            
            let gifUrl = null;
            const reaction = config.welcomeReaction || 'celebrate'; // Default reaction
            try {
                const response = await axios.get(`https://api.otakugifs.xyz/gif?reaction=${reaction}&format=gif`);
                if (response.data && response.data.url) {
                    gifUrl = response.data.url;
                }
            } catch (err) {
                console.error("Failed to fetch OtakuGIF:", err.message);
            }

            if (gifUrl) {
                const embed = new EmbedBuilder()
                    .setDescription(msg)
                    .setImage(gifUrl)
                    .setColor('#00FF00');
                channel.send({ content: `<@${member.id}>`, embeds: [embed] });
            } else {
                channel.send(msg);
            }
        }
    }
});

// Leave Message
client.on('guildMemberRemove', async (member) => {
    const config = getConfig();
    if (config.leaveChannel && config.leaveMessage) {
        const channel = member.guild.channels.cache.get(config.leaveChannel);
        if (channel) {
            const msg = config.leaveMessage.replace('{user}', `**${member.user.tag}**`);
            channel.send(msg);
        }
    }
});

// Prefix commands
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.member) return;

    const allowedRoles = ['1497567054553681950', '1497567055795191808'];
    const hasAllowedRole = message.member.roles.cache.some(role => allowedRoles.includes(role.id));
    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (!hasAllowedRole && !isAdmin) return;

    if (message.content === '!setuptickets') {
        const embed = new EmbedBuilder()
            .setTitle('Support Tickets')
            .setDescription('Click the button below to open a support ticket.')
            .setColor('#0099ff');
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Create Ticket').setStyle(ButtonStyle.Primary)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
        message.delete();
    }

    if (message.content === '!admin') {
        const embed = new EmbedBuilder()
            .setTitle('⚙️ Bot Admin Control Panel')
            .setDescription('Select an option below to configure the bot settings or make announcements using the interactive UI.')
            .setColor('#2b2d31');

        const menu = new StringSelectMenuBuilder()
            .setCustomId('admin_menu')
            .setPlaceholder('Select a category to configure...')
            .addOptions([
                { label: 'Welcome & Leave Settings', value: 'config_welcome', emoji: '👋' },
                { label: 'Auto-Announcement Settings', value: 'config_announce', emoji: '📺' },
                { label: 'Support Tickets Settings', value: 'config_tickets', emoji: '🎫' },
                { label: 'View Current Config', value: 'view_config', emoji: '📋' }
            ]);

        const row1 = new ActionRowBuilder().addComponents(menu);
        
        const btn = new ButtonBuilder().setCustomId('btn_post_announce').setLabel('📢 Post Custom Announcement').setStyle(ButtonStyle.Primary);
        const btnNewAdded = new ButtonBuilder().setCustomId('btn_post_newadded').setLabel('🆕 Force Post Latest Episodes').setStyle(ButtonStyle.Success);
        const row2 = new ActionRowBuilder().addComponents(btn, btnNewAdded);

        await message.channel.send({ embeds: [embed], components: [row1, row2] });
        message.delete();
    }
});

// Button & Modal Interactions
client.on('interactionCreate', async (interaction) => {
    const config = getConfig();

    // Allowed admin roles
    const allowedRoles = ['1497567054553681950', '1497567055795191808'];
    const isAdmin = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    const hasAllowedRole = interaction.member?.roles.cache.some(role => allowedRoles.includes(role.id));
    const isAuthorized = isAdmin || hasAllowedRole;

    // List of customIds that belong to the admin panel
    const adminCustomIds = ['admin_menu', 'btn_post_announce', 'btn_post_newadded', 'modal_welcome', 'modal_announce_cfg', 'modal_tickets_cfg', 'modal_post_announce'];
    
    // Protect admin interactions
    if (adminCustomIds.includes(interaction.customId) && !isAuthorized) {
        return interaction.reply({ content: '❌ You do not have permission to use the admin panel.', ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'admin_menu') {
        const selection = interaction.values[0];

        if (selection === 'view_config') {
            const configStr = Object.entries(config).map(([k, v]) => `**${k}**: ${v || 'Not Set'}`).join('\n');
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Current Configuration').setDescription(configStr).setColor('#00FF00')], ephemeral: true });
        }

        if (selection === 'config_welcome') {
            const modal = new ModalBuilder().setCustomId('modal_welcome').setTitle('Welcome & Leave Setup');
            const wChan = new TextInputBuilder().setCustomId('welcomeChannel').setLabel('Welcome Channel ID').setStyle(TextInputStyle.Short).setValue(config.welcomeChannel || '').setRequired(false);
            const wMsg = new TextInputBuilder().setCustomId('welcomeMessage').setLabel('Welcome Message ({user})').setStyle(TextInputStyle.Paragraph).setValue(config.welcomeMessage || 'Welcome {user}!').setRequired(false);
            const wReac = new TextInputBuilder().setCustomId('welcomeReaction').setLabel('GIF Reaction (e.g., hug, celebrate)').setStyle(TextInputStyle.Short).setValue(config.welcomeReaction || 'celebrate').setRequired(false);
            const lChan = new TextInputBuilder().setCustomId('leaveChannel').setLabel('Leave Channel ID').setStyle(TextInputStyle.Short).setValue(config.leaveChannel || '').setRequired(false);
            
            modal.addComponents(
                new ActionRowBuilder().addComponents(wChan),
                new ActionRowBuilder().addComponents(wMsg),
                new ActionRowBuilder().addComponents(wReac),
                new ActionRowBuilder().addComponents(lChan)
            );
            await interaction.showModal(modal);
        }

        if (selection === 'config_announce') {
            const modal = new ModalBuilder().setCustomId('modal_announce_cfg').setTitle('Auto-Announcement Setup');
            const aChan = new TextInputBuilder().setCustomId('announcementChannel').setLabel('Announcement Channel ID').setStyle(TextInputStyle.Short).setValue(config.announcementChannel || '').setRequired(false);
            const pRole = new TextInputBuilder().setCustomId('pingRole').setLabel('Role ID to Ping (Optional)').setStyle(TextInputStyle.Short).setValue(config.pingRole || '').setRequired(false);
            
            modal.addComponents(
                new ActionRowBuilder().addComponents(aChan),
                new ActionRowBuilder().addComponents(pRole)
            );
            await interaction.showModal(modal);
        }

        if (selection === 'config_tickets') {
            const modal = new ModalBuilder().setCustomId('modal_tickets_cfg').setTitle('Support Tickets Setup');
            const tCat = new TextInputBuilder().setCustomId('ticketCategory').setLabel('Ticket Category ID').setStyle(TextInputStyle.Short).setValue(config.ticketCategory || '').setRequired(false);
            
            modal.addComponents(
                new ActionRowBuilder().addComponents(tCat)
            );
            await interaction.showModal(modal);
        }
    }

    if (interaction.isButton() && interaction.customId === 'btn_post_announce') {
        const modal = new ModalBuilder().setCustomId('modal_post_announce').setTitle('Post Custom Announcement');
        const aChan = new TextInputBuilder().setCustomId('chan').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true);
        const aTitle = new TextInputBuilder().setCustomId('title').setLabel('Announcement Title').setStyle(TextInputStyle.Short).setRequired(true);
        const aDesc = new TextInputBuilder().setCustomId('desc').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true);
        const aImg = new TextInputBuilder().setCustomId('img').setLabel('Image URL (Optional)').setStyle(TextInputStyle.Short).setRequired(false);
        
        modal.addComponents(
            new ActionRowBuilder().addComponents(aChan),
            new ActionRowBuilder().addComponents(aTitle),
            new ActionRowBuilder().addComponents(aDesc),
            new ActionRowBuilder().addComponents(aImg)
        );
        await interaction.showModal(modal);
    }

    if (interaction.isButton() && interaction.customId === 'btn_post_newadded') {
        if (!config.announcementChannel) {
            return interaction.reply({ content: '❌ Announcement channel is not configured! Please configure it in the menu above.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        try {
            const channel = await interaction.guild.channels.fetch(config.announcementChannel);
            const response = await axios.get(API_URL);
            if (!response.data.success || !response.data.results) throw new Error("API returned no data");
            
            // Get the 3 most recent episodes
            const latestEpisodes = response.data.results.slice(0, 3).reverse(); 
            
            for (const ep of latestEpisodes) {
                const embed = new EmbedBuilder()
                    .setTitle(`New Episode Released: ${ep.title}`)
                    .setDescription(`**Season:** ${ep.season} | **Episode:** ${ep.episode}`)
                    .setColor('#FF4500')
                    .setImage(ep.poster || null)
                    .setFooter({ text: 'KagePlay Anime Bot' })
                    .setTimestamp();
                    
                const pingText = config.pingRole ? `<@&${config.pingRole}>` : '';
                await channel.send({ content: `${pingText} A new episode is out!`, embeds: [embed] });
                
                lastSeenId = `${ep.anime_id}-s${ep.season}-e${ep.episode}`;
                fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSeenId }));
            }
            await interaction.editReply({ content: '✅ Successfully fetched and posted the latest 3 episodes to the announcement channel!' });
        } catch (err) {
            await interaction.editReply({ content: `❌ Error fetching episodes: ${err.message}` });
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_welcome') {
            config.welcomeChannel = interaction.fields.getTextInputValue('welcomeChannel');
            config.welcomeMessage = interaction.fields.getTextInputValue('welcomeMessage');
            config.welcomeReaction = interaction.fields.getTextInputValue('welcomeReaction');
            config.leaveChannel = interaction.fields.getTextInputValue('leaveChannel');
            saveConfig(config);
            await interaction.reply({ content: '✅ Welcome & Leave Settings saved!', ephemeral: true });
        }
        if (interaction.customId === 'modal_announce_cfg') {
            config.announcementChannel = interaction.fields.getTextInputValue('announcementChannel');
            config.pingRole = interaction.fields.getTextInputValue('pingRole');
            saveConfig(config);
            await interaction.reply({ content: '✅ Auto-Announcement Settings saved!', ephemeral: true });
        }
        if (interaction.customId === 'modal_tickets_cfg') {
            config.ticketCategory = interaction.fields.getTextInputValue('ticketCategory');
            saveConfig(config);
            await interaction.reply({ content: '✅ Support Tickets Settings saved!', ephemeral: true });
        }
        if (interaction.customId === 'modal_post_announce') {
            const chanId = interaction.fields.getTextInputValue('chan');
            const title = interaction.fields.getTextInputValue('title');
            const desc = interaction.fields.getTextInputValue('desc');
            const img = interaction.fields.getTextInputValue('img');

            try {
                const channel = await interaction.guild.channels.fetch(chanId);
                if (!channel) throw new Error("Channel not found");
                const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor('#0099ff').setTimestamp();
                if (img) embed.setImage(img);
                await channel.send({ embeds: [embed] });
                await interaction.reply({ content: '✅ Announcement posted!', ephemeral: true });
            } catch (err) {
                await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
            }
        }
    }

    if (!interaction.isButton()) return;

    if (interaction.customId === 'create_ticket') {
        const ticketChannelName = `ticket-${interaction.user.username.toLowerCase()}`;
        
        // Check if ticket already exists
        const existingChannel = interaction.guild.channels.cache.find(c => c.name === ticketChannelName);
        if (existingChannel) {
            return interaction.reply({ content: `You already have a ticket open: ${existingChannel}`, ephemeral: true });
        }

        // Create Channel
        const channel = await interaction.guild.channels.create({
            name: ticketChannelName,
            type: ChannelType.GuildText,
            parent: config.ticketCategory || null,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        const embed = new EmbedBuilder()
            .setTitle('Support Ticket')
            .setDescription(`Hello <@${interaction.user.id}>, please describe your issue here. Support will be with you shortly.`)
            .setColor('#00FF00');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
        await interaction.reply({ content: `Ticket created! ${channel}`, ephemeral: true });
    }

    if (interaction.customId === 'close_ticket') {
        await interaction.reply('Closing ticket in 5 seconds...');
        setTimeout(() => interaction.channel.delete(), 5000);
    }
});

client.login(process.env.DISCORD_TOKEN);
