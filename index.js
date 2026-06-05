const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers]
});

const API_BASE = process.env.API_URL || 'https://kageplay.saugii650.workers.dev/api';
const getConfig = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const saveConfig = (data) => fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(data, null, 2));

// --- API HELPERS ---

async function apiFetch(endpoint) {
    const res = await axios.get(`${API_BASE}${endpoint}`, {
        timeout: 15000,
        headers: { 'User-Agent': 'KagePlayBot/1.0' }
    });
    return res.data;
}

function posterUrl(p) { if (!p) return null; return p.startsWith('http') ? p : `https://image.tmdb.org/t/p/w500${p}`; }
function bannerUrl(p) { if (!p) return null; return p.startsWith('http') ? p : `https://image.tmdb.org/t/p/original${p}`; }

// --- SLASH COMMANDS ---

const COMMANDS = [
    new SlashCommandBuilder().setName('latest').setDescription('Show latest uploaded anime episodes'),
    new SlashCommandBuilder().setName('search').setDescription('Search anime').addStringOption(o => o.setName('query').setDescription('Anime name').setRequired(true)),
    new SlashCommandBuilder().setName('anime').setDescription('Get anime info').addStringOption(o => o.setName('id').setDescription('Anime slug').setRequired(true)),
    new SlashCommandBuilder().setName('episodes').setDescription('List episodes').addStringOption(o => o.setName('id').setDescription('Anime slug').setRequired(true)),
    new SlashCommandBuilder().setName('stream').setDescription('Get stream sources').addStringOption(o => o.setName('episode_id').setDescription('Episode ID').setRequired(true)),
];

async function registerCommands() {
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;
    if (!token || !clientId) return console.warn('Skipping command registration: missing DISCORD_TOKEN or CLIENT_ID');
    try {
        await new REST({ version: '10' }).setToken(token).put(Routes.applicationCommands(clientId), { body: COMMANDS });
        console.log('Slash commands registered');
    } catch (e) { console.error('Command registration failed:', e.message); }
}

// --- EPISODE PAGE ---

async function showEpisodesPage(ctx, slug, allEps, page, total, totalPages) {
    const size = 25;
    const start = (page - 1) * size;
    const eps = allEps.slice(start, start + size);

    const embed = new EmbedBuilder()
        .setTitle(`📺 Episodes — ${slug}`)
        .setColor(0xED4245)
        .setDescription(eps.map(e =>
            `**EP ${e.number || e.episode}**${e.title ? ` — ${e.title}` : ''}${e.isFiller ? ' ⚠️ Filler' : ''}\n\`${e.episodeId}\``
        ).join('\n'))
        .setFooter({ text: `Page ${page}/${totalPages} • ${total} total` })
        .setTimestamp();

    const nav = new ActionRowBuilder();
    if (page > 1) nav.addComponents(new ButtonBuilder().setCustomId(`nav_prev_${slug}_${page}_${totalPages}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary));
    if (page < totalPages) nav.addComponents(new ButtonBuilder().setCustomId(`nav_next_${slug}_${page}_${totalPages}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary));

    const select = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`epselect_${slug}`).setPlaceholder('Pick an episode to stream')
            .addOptions(eps.slice(0, 25).map(e => new StringSelectMenuOptionBuilder()
                .setLabel(`EP ${e.number || e.episode}${e.title ? `: ${e.title.slice(0, 50)}` : ''}`)
                .setValue(e.episodeId || `${slug}-${e.season || 1}x${e.number || e.episode}`)
                .setDescription(e.isFiller ? '⚠️ Filler' : (e.title || '').slice(0, 80))
            ))
    );

    const msg = ctx.editReply || ctx.update || ctx.followUp;
    const opts = { embeds: [embed], components: [select] };
    if (nav.components.length) opts.components.push(nav);

    if (ctx.editReply) await ctx.editReply(opts);
    else if (ctx.update) await ctx.update(opts);
    else await ctx.followUp(opts);
}

// --- ANIME INFO EMBED ---

function buildAnimeEmbed(info, slug, moreInfo) {
    const stats = info.stats || {};
    const embed = new EmbedBuilder()
        .setTitle(info.name || 'Unknown')
        .setDescription((info.description || '').slice(0, 400) || 'No description.')
        .setColor(0xED4245)
        .setThumbnail(posterUrl(info.poster))
        .setImage(bannerUrl(info.banner))
        .addFields(
            { name: '⭐ Rating', value: String(stats.rating || 'N/A'), inline: true },
            { name: '📺 Episodes', value: `${stats.episodes?.sub || '?'} Sub / ${stats.episodes?.dub || '?'} Dub`, inline: true },
            { name: '📋 Type', value: stats.type || 'TV', inline: true },
            { name: '🔴 Status', value: moreInfo?.status || 'Unknown', inline: true },
            { name: '⏱ Duration', value: stats.duration || '?', inline: true },
            { name: '🏷️ ID', value: `\`${slug}\``, inline: true }
        )
        .setFooter({ text: 'KagePlay Anime Bot • Powered by PirateXPlay' })
        .setTimestamp();
    return embed;
}

// --- STREAM SOURCES ---

async function fetchStreamSources(episodeId) {
    try {
        const data = await apiFetch(`/episode/sources?animeEpisodeId=${encodeURIComponent(episodeId)}`);
        const sources = data?.data?.sources || [];
        if (sources.length && sources[0].url) return { type: 'direct', sources };
    } catch { /* fallback */ }

    try {
        const data = await apiFetch(`/episode/servers?animeEpisodeId=${encodeURIComponent(episodeId)}`);
        const sd = data?.data;
        if (sd?.unavailable) return { type: 'unavailable' };
        const all = [...(sd?.sub || []), ...(sd?.dub || []), ...(sd?.raw || [])];
        if (all.length) return { type: 'servers', servers: all, episodeNo: sd.episodeNo };
    } catch { /* fallback */ }

    return { type: 'none' };
}

function streamEmbed(episodeId, result) {
    if (result.type === 'unavailable') {
        return new EmbedBuilder()
            .setTitle('❌ Not Available')
            .setDescription('This episode is not available in Hindi yet.')
            .setColor(0xED4245);
    }
    if (result.type === 'none') {
        return new EmbedBuilder()
            .setTitle('❌ No Sources')
            .setDescription('No stream sources found for this episode.')
            .setColor(0xED4245);
    }

    const embed = new EmbedBuilder()
        .setTitle(`🎬 Stream — ${episodeId}`)
        .setColor(0xED4245)
        .setFooter({ text: 'KagePlay Anime Bot' })
        .setTimestamp();

    if (result.type === 'direct') {
        embed.setDescription(result.sources.map((s, i) =>
            `**Source ${i + 1}** (${s.type || 'iframe'}): [▶ Click to Watch](${s.url || '#'})`
        ).join('\n'));
    } else if (result.type === 'servers') {
        embed.setDescription(`**Episode ${result.episodeNo || ''}**\n\n` +
            result.servers.map((s, i) =>
                `**${s.serverName || `Server ${i + 1}`}** (${s.lang || 'N/A'}): [▶ Click to Watch](${s.url})`
            ).join('\n'));
    }
    return embed;
}

// --- MAIN INTERACTION HANDLER ---

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) return handleSlash(interaction);
    if (interaction.isStringSelectMenu()) return handleSelect(interaction);
    if (interaction.isButton()) return handleButton(interaction);
    if (interaction.isModalSubmit()) return handleModal(interaction);
});

// --- SLASH COMMANDS ---

async function handleSlash(interaction) {
    const cmd = interaction.commandName;

    if (cmd === 'latest') {
        await interaction.deferReply();
        try {
            const data = await apiFetch('/home?provider=hindi');
            const list = (data?.data?.latestEpisodeAnimes || []).slice(0, 10);
            if (!list.length) return interaction.editReply('No latest episodes found.');

            const embed = new EmbedBuilder()
                .setTitle('🔥 Latest Uploaded Anime')
                .setColor(0xFF4500)
                .setDescription(list.map((a, i) =>
                    `**${i + 1}.** **${a.name}** — S${a.season} | ⭐ ${a.rating || '?'} | ${a.episodes?.sub || 0} EP`
                ).join('\n'))
                .setFooter({ text: 'KagePlay Anime Bot' })
                .setTimestamp();

            const rows = [];
            for (let i = 0; i < Math.min(list.length, 25); i += 5) {
                const chunk = list.slice(i, i + 5);
                rows.push(new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`latest_${Math.floor(i / 5)}`)
                        .setPlaceholder(`Select ${i + 1}-${i + chunk.length}`)
                        .addOptions(chunk.map(a => new StringSelectMenuOptionBuilder()
                            .setLabel(a.name.length > 100 ? a.name.slice(0, 97) + '...' : a.name)
                            .setValue(a.id)
                            .setDescription(`S${a.season} ⭐${a.rating || '?'}`)
                        ))
                ));
            }

            await interaction.editReply({ embeds: [embed], components: rows });
        } catch (e) {
            await interaction.editReply(`❌ ${e.message}`);
        }
        return;
    }

    if (cmd === 'search') {
        const query = interaction.options.getString('query');
        await interaction.deferReply();
        try {
            const data = await apiFetch(`/search?q=${encodeURIComponent(query)}&provider=hindi`);
            const animes = data?.data?.animes || [];
            if (!animes.length) return interaction.editReply(`No results for **${query}**.`);

            const embed = new EmbedBuilder()
                .setTitle(`🔎 Search: "${query}"`)
                .setColor(0x5865F2)
                .setDescription(animes.map((a, i) =>
                    `**${i + 1}.** **${a.name}** — ${a.type || 'TV'} | ${a.episodes?.sub || '?'} EP`
                ).join('\n'))
                .setFooter({ text: `${animes.length} results` })
                .setTimestamp();

            const select = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('search_result').setPlaceholder('Select anime for details')
                    .addOptions(animes.slice(0, 25).map(a => new StringSelectMenuOptionBuilder()
                        .setLabel(a.name.length > 100 ? a.name.slice(0, 97) + '...' : a.name)
                        .setValue(a.id).setDescription(`${a.type || 'TV'} • ${a.episodes?.sub || '?'} EP`)
                    ))
            );

            await interaction.editReply({ embeds: [embed], components: [select] });
        } catch (e) {
            await interaction.editReply(`❌ Search failed: ${e.message}`);
        }
        return;
    }

    if (cmd === 'anime') {
        const id = interaction.options.getString('id');
        await interaction.deferReply();
        try {
            const data = await apiFetch(`/anime/${encodeURIComponent(id)}`);
            const info = data?.data?.anime?.info;
            if (!info) return interaction.editReply('Anime not found.');

            const seasons = data?.data?.anime?.seasons || [];
            const moreInfo = data?.data?.anime?.moreInfo || {};
            const embed = buildAnimeEmbed(info, id, moreInfo);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`epbtn_${id}`).setLabel('📺 View Episodes').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`sbtn_${id}`).setLabel('📂 Seasons').setStyle(ButtonStyle.Secondary).setDisabled(seasons.length <= 1)
            );

            await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (e) {
            await interaction.editReply(`❌ ${e.message}`);
        }
        return;
    }

    if (cmd === 'episodes') {
        const id = interaction.options.getString('id');
        await interaction.deferReply();
        try {
            const data = await apiFetch(`/anime/${encodeURIComponent(id)}/episodes`);
            const allEps = data?.data?.episodes || [];
            if (!allEps.length) return interaction.editReply('No episodes found.');

            const total = data?.data?.totalEpisodes || allEps.length;
            const pages = Math.ceil(allEps.length / 25);
            await showEpisodesPage(interaction, id, allEps, 1, total, pages);
        } catch (e) {
            await interaction.editReply(`❌ ${e.message}`);
        }
        return;
    }

    if (cmd === 'stream') {
        const episodeId = interaction.options.getString('episode_id');
        await interaction.deferReply();
        try {
            const result = await fetchStreamSources(episodeId);
            await interaction.editReply({ embeds: [streamEmbed(episodeId, result)] });
        } catch (e) {
            await interaction.editReply(`❌ ${e.message}`);
        }
        return;
    }
}

// --- SELECT MENUS ---

async function handleSelect(interaction) {
    const val = interaction.values[0];
    const cid = interaction.customId;

    // Latest anime select
    if (cid.startsWith('latest_')) {
        await interaction.deferUpdate();
        try {
            const data = await apiFetch(`/anime/${encodeURIComponent(val)}`);
            const info = data?.data?.anime?.info;
            if (!info) return interaction.followUp({ content: 'Anime info not found.', ephemeral: true });

            const seasons = data?.data?.anime?.seasons || [];
            const moreInfo = data?.data?.anime?.moreInfo || {};
            const embed = buildAnimeEmbed(info, val, moreInfo);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`epbtn_${val}`).setLabel('📺 View Episodes').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`sbtn_${val}`).setLabel('📂 Seasons').setStyle(ButtonStyle.Secondary).setDisabled(seasons.length <= 1)
            );
            await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (e) {
            await interaction.followUp({ content: `❌ ${e.message}`, ephemeral: true });
        }
        return;
    }

    // Search result select
    if (cid === 'search_result' || cid === 'search_channel_sel') {
        await interaction.deferUpdate();
        try {
            const data = await apiFetch(`/anime/${encodeURIComponent(val)}`);
            const info = data?.data?.anime?.info;
            if (!info) return interaction.followUp({ content: 'Not found.', ephemeral: true });

            const seasons = data?.data?.anime?.seasons || [];
            const moreInfo = data?.data?.anime?.moreInfo || {};
            const embed = buildAnimeEmbed(info, val, moreInfo);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`epbtn_${val}`).setLabel('📺 View Episodes').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`sbtn_${val}`).setLabel('📂 Seasons').setStyle(ButtonStyle.Secondary).setDisabled(seasons.length <= 1)
            );
            await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (e) {
            await interaction.followUp({ content: `❌ ${e.message}`, ephemeral: true });
        }
        return;
    }

    // Episode select
    if (cid.startsWith('epselect_')) {
        await interaction.deferUpdate();
        try {
            const result = await fetchStreamSources(val);
            await interaction.editReply({ embeds: [streamEmbed(val, result)] });
        } catch (e) {
            await interaction.followUp({ content: `❌ ${e.message}`, ephemeral: true });
        }
        return;
    }

    // Season select
    if (cid.startsWith('season_sel_')) {
        await interaction.deferUpdate();
        try {
            const data = await apiFetch(`/anime/${encodeURIComponent(val)}/episodes`);
            const allEps = data?.data?.episodes || [];
            if (!allEps.length) return interaction.followUp({ content: 'No episodes in this season.', ephemeral: true });

            const total = allEps.length;
            const pages = Math.ceil(total / 25);
            await showEpisodesPage(interaction, val, allEps, 1, total, pages);
        } catch (e) {
            await interaction.followUp({ content: `❌ ${e.message}`, ephemeral: true });
        }
        return;
    }

    // Admin menu
    if (cid === 'admin_menu') {
        const config = getConfig();
        const sel = interaction.values[0];

        if (sel === 'view_config') {
            const str = Object.entries(config).map(([k, v]) => `**${k}**: ${v || 'Not Set'}`).join('\n');
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Configuration').setDescription(str).setColor('#00FF00')], ephemeral: true });
        }

        const modal = new ModalBuilder();
        if (sel === 'config_welcome') {
            modal.setCustomId('modal_welcome').setTitle('Welcome & Leave Setup');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('welcomeChannel').setLabel('Welcome Channel ID').setStyle(TextInputStyle.Short).setValue(config.welcomeChannel || '').setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('welcomeMessage').setLabel('Welcome Message').setStyle(TextInputStyle.Paragraph).setValue(config.welcomeMessage || 'Welcome {user}!').setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('welcomeReaction').setLabel('GIF Reaction').setStyle(TextInputStyle.Short).setValue(config.welcomeReaction || 'celebrate').setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('leaveChannel').setLabel('Leave Channel ID').setStyle(TextInputStyle.Short).setValue(config.leaveChannel || '').setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('leaveMessage').setLabel('Leave Message').setStyle(TextInputStyle.Short).setValue(config.leaveMessage || 'Goodbye {user}.').setRequired(false))
            );
        } else if (sel === 'config_announce') {
            modal.setCustomId('modal_announce_cfg').setTitle('Auto-Announcement Setup');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('announcementChannel').setLabel('Channel ID').setStyle(TextInputStyle.Short).setValue(config.announcementChannel || '').setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pingRole').setLabel('Ping Role ID').setStyle(TextInputStyle.Short).setValue(config.pingRole || '').setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('searchChannel').setLabel('Search Channel ID').setStyle(TextInputStyle.Short).setValue(config.searchChannel || '').setRequired(false))
            );
        } else if (sel === 'config_tickets') {
            modal.setCustomId('modal_tickets_cfg').setTitle('Support Tickets Setup');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ticketCategory').setLabel('Ticket Category ID').setStyle(TextInputStyle.Short).setValue(config.ticketCategory || '').setRequired(false))
            );
        }

        if (modal.data.components?.length) await interaction.showModal(modal);
        return;
    }
}

// --- BUTTONS ---

async function handleButton(interaction) {
    const cid = interaction.customId;

    // Auth check for admin buttons
    const adminIds = ['btn_post_announce', 'btn_post_newadded'];
    if (adminIds.includes(cid)) {
        const config = getConfig();
        const allowedRoles = ['1497567054553681950', '1497567055795191808'];
        const isAdmin = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator);
        const hasRole = interaction.member?.roles.cache.some(r => allowedRoles.includes(r.id));
        if (!isAdmin && !hasRole) return interaction.reply({ content: '❌ No permission.', ephemeral: true });

        if (cid === 'btn_post_announce') {
            const modal = new ModalBuilder().setCustomId('modal_post_announce').setTitle('Post Announcement');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('chan').setLabel('Channel ID').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('img').setLabel('Image URL').setStyle(TextInputStyle.Short).setRequired(false))
            );
            await interaction.showModal(modal);
            return;
        }

        if (cid === 'btn_post_newadded') {
            if (!config.announcementChannel) return interaction.reply({ content: '❌ Announcement channel not configured.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            try {
                const home = await apiFetch('/home?provider=hindi');
                const list = (home?.data?.latestEpisodeAnimes || []).slice(0, 5);
                if (!list.length) throw new Error('No episodes found');

                const channel = await interaction.guild.channels.fetch(config.announcementChannel);
                for (const a of list) {
                    const embed = new EmbedBuilder()
                        .setTitle(`🎬 ${a.name}`)
                        .setDescription(`**Season:** ${a.season || 1} | **Rating:** ⭐ ${a.rating || '?'}\n**Episodes:** ${a.episodes?.sub || 0} Sub / ${a.episodes?.dub || 0} Dub`)
                        .setColor(0xFF4500)
                        .setThumbnail(posterUrl(a.poster))
                        .setFooter({ text: 'KagePlay Anime Bot' })
                        .setTimestamp();
                    const ping = config.pingRole ? `<@&${config.pingRole}>` : '';
                    await channel.send({ content: `${ping} New episode available!`, embeds: [embed] });
                }
                await interaction.editReply({ content: `✅ Posted ${list.length} to <#${config.announcementChannel}>!` });
            } catch (e) {
                await interaction.editReply({ content: `❌ ${e.message}` });
            }
            return;
        }
    }

    // Episode button
    if (cid.startsWith('epbtn_')) {
        const slug = cid.slice(6);
        await interaction.deferUpdate();
        try {
            const data = await apiFetch(`/anime/${encodeURIComponent(slug)}/episodes`);
            const eps = data?.data?.episodes || [];
            if (!eps.length) return interaction.followUp({ content: 'No episodes.', ephemeral: true });
            const total = data?.data?.totalEpisodes || eps.length;
            await showEpisodesPage(interaction, slug, eps, 1, total, Math.ceil(eps.length / 25));
        } catch (e) {
            await interaction.followUp({ content: `❌ ${e.message}`, ephemeral: true });
        }
        return;
    }

    // Seasons button
    if (cid.startsWith('sbtn_')) {
        const slug = cid.slice(5);
        await interaction.deferUpdate();
        try {
            const data = await apiFetch(`/anime/${encodeURIComponent(slug)}`);
            const seasons = data?.data?.anime?.seasons || [];
            if (!seasons.length) return interaction.followUp({ content: 'No seasons.', ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle(`📂 Seasons — ${data?.data?.anime?.info?.name || slug}`)
                .setColor(0x5865F2)
                .setDescription(seasons.map((s, i) => `**${i + 1}.** ${s.title || s.name}${s.isCurrent ? ' (Current)' : ''}`).join('\n'))
                .setFooter({ text: 'Select a season' })
                .setTimestamp();

            const select = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`season_sel_${slug}`).setPlaceholder('Pick a season')
                    .addOptions(seasons.slice(0, 25).map(s => new StringSelectMenuOptionBuilder()
                        .setLabel(s.title || s.name).setValue(s.id)
                        .setDescription(s.isCurrent ? 'Current' : '')
                    ))
            );

            await interaction.editReply({ embeds: [embed], components: [select] });
        } catch (e) {
            await interaction.followUp({ content: `❌ ${e.message}`, ephemeral: true });
        }
        return;
    }

    // Episode navigation
    if (cid.startsWith('nav_')) {
        const parts = cid.split('_');
        const dir = parts[1];
        const slug = parts.slice(2, -2).join('_');
        const cur = parseInt(parts[parts.length - 2]);
        const totPages = parseInt(parts[parts.length - 1]);
        const newPage = dir === 'prev' ? cur - 1 : cur + 1;

        await interaction.deferUpdate();
        try {
            const data = await apiFetch(`/anime/${encodeURIComponent(slug)}/episodes`);
            const eps = data?.data?.episodes || [];
            if (!eps.length) return interaction.followUp({ content: 'No episodes.', ephemeral: true });
            const total = data?.data?.totalEpisodes || eps.length;
            await showEpisodesPage(interaction, slug, eps, newPage, total, totPages);
        } catch (e) {
            await interaction.followUp({ content: `❌ ${e.message}`, ephemeral: true });
        }
        return;
    }

    // Tickets
    if (cid === 'create_ticket') {
        const config = getConfig();
        const name = `ticket-${interaction.user.username.toLowerCase()}`;
        const existing = interaction.guild.channels.cache.find(c => c.name === name);
        if (existing) return interaction.reply({ content: `You have a ticket: ${existing}`, ephemeral: true });

        const channel = await interaction.guild.channels.create({
            name, type: ChannelType.GuildText,
            parent: config.ticketCategory || null,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        const embed = new EmbedBuilder()
            .setTitle('Support Ticket')
            .setDescription(`Hello <@${interaction.user.id}>, describe your issue.`)
            .setColor('#00FF00');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Close').setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
        await interaction.reply({ content: `Ticket created! ${channel}`, ephemeral: true });
        return;
    }

    if (cid === 'close_ticket') {
        await interaction.reply('Closing in 5s...');
        setTimeout(() => interaction.channel.delete(), 5000);
        return;
    }
}

// --- MODALS ---

async function handleModal(interaction) {
    const config = getConfig();
    const cid = interaction.customId;

    if (cid === 'modal_welcome') {
        config.welcomeChannel = interaction.fields.getTextInputValue('welcomeChannel');
        config.welcomeMessage = interaction.fields.getTextInputValue('welcomeMessage');
        config.welcomeReaction = interaction.fields.getTextInputValue('welcomeReaction');
        config.leaveChannel = interaction.fields.getTextInputValue('leaveChannel');
        config.leaveMessage = interaction.fields.getTextInputValue('leaveMessage');
        saveConfig(config);
        await interaction.reply({ content: '✅ Welcome & Leave saved!', ephemeral: true });
        return;
    }

    if (cid === 'modal_announce_cfg') {
        config.announcementChannel = interaction.fields.getTextInputValue('announcementChannel');
        config.pingRole = interaction.fields.getTextInputValue('pingRole');
        config.searchChannel = interaction.fields.getTextInputValue('searchChannel');
        saveConfig(config);
        await interaction.reply({ content: '✅ Announcement settings saved!', ephemeral: true });
        return;
    }

    if (cid === 'modal_tickets_cfg') {
        config.ticketCategory = interaction.fields.getTextInputValue('ticketCategory');
        saveConfig(config);
        await interaction.reply({ content: '✅ Ticket settings saved!', ephemeral: true });
        return;
    }

    if (cid === 'modal_post_announce') {
        const chanId = interaction.fields.getTextInputValue('chan');
        const title = interaction.fields.getTextInputValue('title');
        const desc = interaction.fields.getTextInputValue('desc');
        const img = interaction.fields.getTextInputValue('img');
        try {
            const channel = await interaction.guild.channels.fetch(chanId);
            if (!channel) throw new Error('Channel not found');
            const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor('#0099ff').setTimestamp();
            if (img) embed.setImage(img);
            await channel.send({ embeds: [embed] });
            await interaction.reply({ content: '✅ Posted!', ephemeral: true });
        } catch (e) {
            await interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
        }
        return;
    }
}

// --- SEARCH CHANNEL ---

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const config = getConfig();

    if (config.searchChannel && message.channel.id === config.searchChannel) {
        const query = message.content.trim();
        if (!query) return;

        const m = await message.channel.send(`🔎 Searching **${query}**...`);
        try {
            const data = await apiFetch(`/search?q=${encodeURIComponent(query)}&provider=hindi`);
            const animes = data?.data?.animes || [];
            if (!animes.length) return m.edit(`No results for **${query}**.`);

            const embed = new EmbedBuilder()
                .setTitle(`🔎 "${query}"`)
                .setColor(0x5865F2)
                .setDescription(animes.map((a, i) =>
                    `**${i + 1}.** **${a.name}** — ${a.type || 'TV'} | ${a.episodes?.sub || '?'} EP`
                ).join('\n'))
                .setFooter({ text: `Requested by ${message.author.username}` })
                .setTimestamp();

            const select = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('search_channel_sel').setPlaceholder('Select anime')
                    .addOptions(animes.slice(0, 25).map(a => new StringSelectMenuOptionBuilder()
                        .setLabel(a.name.length > 100 ? a.name.slice(0, 97) + '...' : a.name)
                        .setValue(a.id).setDescription(`${a.type || 'TV'} • ${a.episodes?.sub || '?'} EP`)
                    ))
            );

            await m.edit({ content: null, embeds: [embed], components: [select] });
        } catch (e) {
            await m.edit(`❌ ${e.message}`);
        }
        return;
    }

    // Prefix commands
    if (!message.member) return;
    const allowedRoles = ['1497567054553681950', '1497567055795191808'];
    const hasRole = message.member.roles.cache.some(r => allowedRoles.includes(r.id));
    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!hasRole && !isAdmin) return;

    if (message.content === '!setuptickets') {
        const embed = new EmbedBuilder().setTitle('Support Tickets').setDescription('Click the button below to open a support ticket.').setColor('#0099ff');
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Create Ticket').setStyle(ButtonStyle.Primary));
        await message.channel.send({ embeds: [embed], components: [row] });
        message.delete();
        return;
    }

    if (message.content === '!admin') {
        const embed = new EmbedBuilder()
            .setTitle('⚙️ Admin Panel').setDescription('Configure the bot using the options below.').setColor('#2b2d31');
        const menu = new StringSelectMenuBuilder().setCustomId('admin_menu').setPlaceholder('Select category...')
            .addOptions([
                { label: 'Welcome & Leave', value: 'config_welcome', emoji: '👋' },
                { label: 'Auto-Announcements', value: 'config_announce', emoji: '📺' },
                { label: 'Support Tickets', value: 'config_tickets', emoji: '🎫' },
                { label: 'View Config', value: 'view_config', emoji: '📋' }
            ]);
        const row1 = new ActionRowBuilder().addComponents(menu);
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_post_announce').setLabel('📢 Post Announcement').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('btn_post_newadded').setLabel('🆕 Post Latest').setStyle(ButtonStyle.Success)
        );
        await message.channel.send({ embeds: [embed], components: [row1, row2] });
        message.delete();
        return;
    }
});

// --- WELCOME / LEAVE ---

client.on('guildMemberAdd', async (member) => {
    const config = getConfig();
    if (!config.welcomeChannel || !config.welcomeMessage) return;
    const channel = member.guild.channels.cache.get(config.welcomeChannel);
    if (!channel) return;

    const msg = config.welcomeMessage.replace('{user}', `<@${member.id}>`);
    let gifUrl = null;
    try {
        const res = await axios.get(`https://api.otakugifs.xyz/gif?reaction=${config.welcomeReaction || 'celebrate'}&format=gif`);
        if (res.data?.url) gifUrl = res.data.url;
    } catch { /* ignore */ }

    if (gifUrl) {
        channel.send({ content: `<@${member.id}>`, embeds: [new EmbedBuilder().setDescription(msg).setImage(gifUrl).setColor('#00FF00')] });
    } else {
        channel.send(msg);
    }
});

client.on('guildMemberRemove', async (member) => {
    const config = getConfig();
    if (!config.leaveChannel || !config.leaveMessage) return;
    const channel = member.guild.channels.cache.get(config.leaveChannel);
    if (!channel) return;
    channel.send(config.leaveMessage.replace('{user}', `**${member.user.tag}**`));
});

// --- READY ---

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`🌐 Invite URL: https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&integration_type=0&scope=bot+applications.commands`);
    
    if (!process.env.CLIENT_ID) {
        console.warn('⚠️  CLIENT_ID not set in .env — slash commands will NOT be registered.');
        console.warn('   Add CLIENT_ID to your .env file and restart the bot.');
    } else {
        await registerCommands();
    }

    setInterval(async () => {
        const config = getConfig();
        if (!config.announcementChannel) return;

        try {
            const data = await apiFetch('/home?provider=hindi');
            const list = data?.data?.latestEpisodeAnimes || [];
            if (!list.length) return;

            const stateFile = path.join(__dirname, 'last_seen.json');
            let lastSeen = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')).lastSeenId : null;

            const newItems = [];
            for (const a of list) {
                if (a.id === lastSeen) break;
                newItems.unshift(a);
            }

            if (newItems.length) {
                const channel = client.channels.cache.get(config.announcementChannel);
                if (channel) {
                    for (const a of newItems) {
                        const embed = new EmbedBuilder()
                            .setTitle(`🎬 ${a.name}`)
                            .setDescription(`**Season:** ${a.season || 1} | **Rating:** ⭐ ${a.rating || '?'} | **Episodes:** ${a.episodes?.sub || 0} Sub / ${a.episodes?.dub || 0} Dub`)
                            .setColor(0xFF4500)
                            .setImage(bannerUrl(a.banner))
                            .setThumbnail(posterUrl(a.poster))
                            .setFooter({ text: 'KagePlay Anime Bot • New Episode!' })
                            .setTimestamp();
                        const ping = config.pingRole ? `<@&${config.pingRole}>` : '';
                        await channel.send({ content: `${ping} A new episode is out!`, embeds: [embed] });
                    }
                }
                fs.writeFileSync(stateFile, JSON.stringify({ lastSeenId: newItems[0].id }));
            }
        } catch (e) {
            console.error('Auto-announcement error:', e.message);
        }
    }, 5 * 60 * 1000);
});

client.login(process.env.DISCORD_TOKEN);
