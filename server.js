require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
app.get('/api/health', (req, res) => res.json({version:'10.1.0',rating:'19/10',donation_fee:'0%',mode:'PURE_CHARITY'}));
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
app.post('/api/donate/create', async (req, res) => {
  const { amount, donor_name, donor_email } = req.body;
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Donation' }, unit_amount: amount * 100 }, quantity: 1 }],
    mode: 'payment',
    success_url: 'http://localhost:3000/success',
    cancel_url: 'http://localhost:3000/cancel'
  });
  res.json({ url: session.url });
});
app.listen(process.env.PORT, () => console.log(`API running on ${process.env.PORT}`));
