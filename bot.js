require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Partials } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers, // Necessário para listar quem tem o cargo
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

// Configurações e Variáveis de Controle
const CONFIG = {
    railwayToken: process.env.RAILWAY_TOKEN,
    workspaceId: process.env.WORKSPACE_ID,
    channelId: process.env.CHANNEL_ID,
    roleId: process.env.ROLE_ID,
    endpoint: "https://backboard.railway.com/graphql/v2"
};

let panelMessage = null;
let lastNearLimitAlert = 0; // Timestamp do último alerta de "2 dol"
let lastExceededAlert = 0;  // Timestamp do último alerta de "Fodase"

// Query que validamos anteriormente
const RAILWAY_QUERY = `
  query getUsage {
    workspace(workspaceId: "${CONFIG.workspaceId}") {
      name
      customer {
        currentUsage
        usageLimit {
          hardLimit
          isOverLimit
        }
      }
    }
  }
`;

async function getRailwayData() {
    try {
        const response = await fetch(CONFIG.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${CONFIG.railwayToken}`
            },
            body: JSON.stringify({ query: RAILWAY_QUERY })
        });
        const json = await response.json();
        return json.data.workspace;
    } catch (e) {
        console.error("Erro ao buscar API Railway:", e);
        return null;
    }
}

async function notifyUsers(message, isCritical) {
    const guild = client.guilds.cache.first(); // Pega o servidor onde o bot está
    if (!guild) return;

    await guild.members.fetch(); // Atualiza cache de membros
    const membersWithRole = guild.roles.cache.get(CONFIG.roleId).members;

    membersWithRole.forEach(member => {
        if (!member.user.bot) {
            member.send(message).catch(err => console.error(`Não consegui mandar DM para ${member.user.tag}`));
        }
    });
}

async function updateBot() {
    const data = await getRailwayData();
    if (!data) return;

    const usage = data.customer.currentUsage;
    const limit = data.customer.usageLimit.hardLimit;
    const isOver = data.customer.usageLimit.isOverLimit;
    const diff = limit - usage;

    // 1. ATUALIZA O PAINEL (CADA 5 MIN)
    const embed = new EmbedBuilder()
        .setTitle("GERENCIADOR DE CUSTOS - RAILWAY")
        .setDescription("Os usuários com o cargo <@&1494291006693310464> irão receber notificações quando o custo chegar próximo ao limite. Ao passar do limite, as notificações serão enviadas de 1 em 1 minuto.")
        .addFields(
            { name: "USO ATUAL", value: `\`\`\`$${usage.toFixed(2)}\`\`\``, inline: false },
            { name: "LIMITE DE USO", value: `\`\`\`$${limit}\`\`\``, inline: false },
            { name: "LIMITE EXCEDIDO ?", value: `\`\`\`${isOver ? "SIM" : "NÃO"}\`\`\``, inline: false },
        )
        .setColor(isOver ? "#FF0000" : "#610085")
        .setFooter({ text: "Atualizado a cada 5 minutos" })
        .setTimestamp();

    const channel = client.channels.cache.get(CONFIG.channelId);
    if (channel) {
        if (!panelMessage) {
            // Tenta achar a última mensagem do bot no canal para não floodar
            const messages = await channel.messages.fetch({ limit: 10 });
            panelMessage = messages.find(m => m.author.id === client.user.id);
            
            if (!panelMessage) {
                panelMessage = await channel.send({ embeds: [embed] });
            } else {
                await panelMessage.edit({ embeds: [embed] });
            }
        } else {
            await panelMessage.edit({ embeds: [embed] });
        }
    }

    // 2. LÓGICA DE ALERTAS NO PRIVADO
    const now = Date.now();

    // Cenário CRÍTICO: Is Over Limit (1 em 1 minuto)
    if (isOver) {
        if (now - lastExceededAlert >= 60000) { // 60 seg
            await notifyUsers(`🚨 **PAGAMENTO EXCEDIDO / APP PARADA!**\nO limite de $${limit} estourou! Consumo atual: $${usage.toFixed(2)}. Vá ao Railway AGORA!`, true);
            lastExceededAlert = now;
        }
    } 
    // Cenário PREVENTIVO: Falta menos de 2 dol (1 em 1 hora)
    else if (diff <= 2.00) {
        if (now - lastNearLimitAlert >= 3600000) { // 1 hora
            await notifyUsers(`⚠️ **AVISO DE FATURA PRÓXIMA**\nFaltam apenas $${diff.toFixed(2)} para atingir o limite de $${limit}. Fique atento!`, false);
            lastNearLimitAlert = now;
        }
    }
}

client.once('ready', () => {
    console.log(`Bot online como ${client.user.tag}`);
    
    // Executa uma vez ao ligar
    updateBot();

    // Roda a verificação principal a cada 1 minuto (para o alerta de 1min funcionar)
    // A atualização do Painel de 5 min é controlada internamente ou apenas roda sempre
    setInterval(updateBot, 60000); 
});

client.login(process.env.DISCORD_TOKEN);