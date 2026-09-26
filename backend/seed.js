require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Category = require('./models/Category');

const categories = ['Bitcoin', 'Ethereum', 'Altcoins', 'DeFi', 'NFTs', 'Web3', 'Regulation'];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB for seeding...');

  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const existingAdmin = await User.findOne({ email: adminEmail });

  if (!existingAdmin) {
    await User.create({
      name: 'CoinGabbarSignals Admin',
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      role: 'admin'
    });
    console.log('Admin user created:', process.env.ADMIN_EMAIL);
  } else {
    console.log('Admin user already exists, skipping.');
  }

  for (const name of categories) {
    const slug = name.toLowerCase();
    const exists = await Category.findOne({ slug });
    if (!exists) await Category.create({ name, slug });
  }
  console.log('Categories seeded.');

  console.log('Seed complete. You can now log in with your admin email/password.');
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
