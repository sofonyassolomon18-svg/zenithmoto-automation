require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const { publishPost, flushTikTokTelegram } = require('./publisher');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// imageUrl = photo publique de la moto (pour Instagram). Remplacer par vraies photos zenithmoto.ch
const FLEET = [
  { name: 'Tracer 700 2024', type: 'roadster sport', style: 'aventure et liberté sur route',
    imageUrl: process.env.IMG_TRACER_700 || null },
  { name: 'X-ADV 2025', type: 'adventure scooter', style: 'exploration urbaine et tout-terrain',
    imageUrl: process.env.IMG_XADV_2025 || null },
  { name: 'T-Max', type: 'scooter premium', style: 'luxe, confort et prestige',
    imageUrl: process.env.IMG_TMAX || null },
  { name: 'X-Max 300', type: 'scooter intermédiaire', style: 'polyvalence et élégance',
    imageUrl: process.env.IMG_XMAX300 || null },
  { name: 'X-Max 125', type: 'scooter accessible', style: 'liberté urbaine pour tous',
    imageUrl: process.env.IMG_XMAX125 || null },
];

const PLATFORM_PROMPTS = {
  instagram: (moto) => `Tu es le community manager de ZenithMoto, agence de location de motos à Bienne (Suisse).
Génère un post Instagram en français pour la ${moto.name} (${moto.type}).
Style : esthétique, lifestyle, émotionnel. Évoque ${moto.style}.
Format : 3-4 phrases percutantes + 15 hashtags français/suisses pertinents.
Inclus un call-to-action pour réserver sur zenithmoto.ch.
Ton : inspirant, premium, aventurier.`,

  tiktok: (moto) => `Tu es le community manager de ZenithMoto, agence de location de motos à Bienne (Suisse).
Génère un script TikTok court en français pour la ${moto.name}.
Style : punchy, dynamique, langage jeune et moderne.
Format : accroche (1 phrase choc) + 3 phrases max + CTA.
Inclus des emojis. Max 150 caractères par phrase.
Ton : fun, énergique, Gen-Z friendly.`,

  facebook: (moto) => `Tu es le community manager de ZenithMoto, agence de location de motos à Bienne (Biel), Suisse.
Génère un post Facebook en français pour la ${moto.name} (${moto.type}).
Style : informatif, professionnel, accessible.
Format : présentation du modèle (caractéristiques clés) + avantages location + tarifs indicatifs (à partir de CHF 120/jour) + CTA.
Inclus 5-8 hashtags. Mention : disponible à Bienne, réservation sur zenithmoto.ch.
Ton : chaleureux, professionnel, de confiance.`,
};

async function generatePost(moto, platform) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent(PLATFORM_PROMPTS[platform](moto));
  return result.response.text();
}

async function generateAllPosts() {
  console.log('🤖 Génération des posts via Gemini AI...\n');
  const date = new Date().toISOString().split('T')[0];
  const postsDir = path.join(__dirname, '..', 'posts');

  for (const moto of FLEET) {
    console.log(`  📱 ${moto.name}...`);
    const result = { moto: moto.name, date, posts: {} };

    for (const platform of ['instagram', 'tiktok', 'facebook']) {
      try {
        result.posts[platform] = await generatePost(moto, platform);
        process.stdout.write(`    ✅ ${platform} `);
      } catch (e) {
        result.posts[platform] = null;
        process.stdout.write(`    ❌ ${platform} `);
        console.error(e.message);
      }
    }
    console.log('');

    const filename = `${date}_${moto.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    fs.writeFileSync(path.join(postsDir, filename), JSON.stringify(result, null, 2));

    // Publier sur les réseaux sociaux
    console.log(`  🚀 Publication ${moto.name}...`);
    await publishPost({ moto: moto.name, posts: result.posts, imageUrl: moto.imageUrl });
  }

  // Envoyer le digest TikTok Telegram une fois tous les posts traités
  await flushTikTokTelegram();

  console.log(`\n✅ Posts générés et publiés\n`);
}

module.exports = { generateAllPosts };

if (require.main === module) {
  generateAllPosts().catch(console.error);
}
