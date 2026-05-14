// ============================================================
// BUSINESS SPECIALIZATIONS — Hotel, Restaurant, Retail, Salon,
// Pharmacy, Gym, Hardware, Supermarket, Transport, Electronics
// ============================================================
module.exports = function(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt) {

// Add all tables to VALID_TABLES
['hotel_rooms','hotel_reservations','hotel_housekeeping',
 'restaurant_menu_items','restaurant_tables','restaurant_orders','restaurant_order_items',
 'retail_products','retail_sales','retail_sale_items',
 'salon_services','salon_staff','salon_appointments',
 'pharmacy_drugs','pharmacy_sales','pharmacy_sale_items',
 'gym_memberships','gym_members','gym_check_ins',
 'hardware_products','hardware_quotations','hardware_quotation_items',
 'supermarket_products','supermarket_daily_sales',
 'transport_fleet','transport_bookings',
 'electronics_products','electronics_repairs'
].forEach(t => { try { VALID_TABLES && VALID_TABLES.add(t); } catch(e) {} });

const SVG = {
  bar: (data, w=400, h=200, color='#4f46e5') => {
    const max = Math.max(...data.map(d=>d.value),1);
    const bw = Math.min(50,(w-40)/data.length-8);
    let s=`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    data.forEach((d,i)=>{const bh=(d.value/max)*(h-50);const x=30+i*(bw+8);const y=h-30-bh;
      s+=`<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="4" fill="${color}" opacity="0.85"/>`;
      s+=`<text x="${x+bw/2}" y="${h-8}" text-anchor="middle" font-size="10" fill="#64748b">${(d.label||'').substring(0,10)}</text>`;
      s+=`<text x="${x+bw/2}" y="${y-4}" text-anchor="middle" font-size="11" fill="#1e293b" font-weight="600">${d.value}</text>`;});
    s+=`</svg>`;return s;
  },
  donut: (data, w=200, h=200) => {
    const total=data.reduce((s,d)=>s+d.value,0)||1;let cum=0;let s=`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    const cx=w/2,cy=h/2,r=70,ir=40;
    data.forEach(d=>{const pct=d.value/total;const start=cum*360;cum+=pct;
      const x1=cx+r*Math.cos((start-90)*Math.PI/180),y1=cy+r*Math.sin((start-90)*Math.PI/180);
      const x2=cx+r*Math.cos((start+pct*360-90)*Math.PI/180),y2=cy+r*Math.sin((start+pct*360-90)*Math.PI/180);
      const large=pct>0.5?1:0;
      s+=`<path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${cx+ir*Math.cos((start+pct*360-90)*Math.PI/180)},${cy+ir*Math.sin((start+pct*360-90)*Math.PI/180)} A${ir},${ir} 0 ${large},0 ${cx+ir*Math.cos((start-90)*Math.PI/180)},${cy+ir*Math.sin((start-90)*Math.PI/180)} Z" fill="${d.color}" opacity="0.85"/>`;
      const mid=(start+pct*360/2-90)*Math.PI/180;const tx=cx+(r+15)*Math.cos(mid),ty=cy+(r+15)*Math.sin(mid);
      s+=`<text x="${tx}" y="${ty}" text-anchor="middle" font-size="10" fill="#475569">${d.label} ${Math.round(pct*100)}%</text>`;});
    s+=`</svg>`;return s;
  }
};

const statCard = (label,value,color='#4f46e5',icon='') => `<div style="background:white;border-radius:12px;padding:20px;border:1px solid #e2e8f0;text-align:center">
  <div style="font-size:28px;margin-bottom:4px">${icon}</div>
  <div style="font-size:28px;font-weight:800;color:${color}">${value}</div>
  <div style="font-size:13px;color:#64748b;margin-top:2px">${label}</div></div>`;

const sel = (name, options, selected='', attrs='') => `<select name="${name}" ${attrs}><option value="">Select...</option>${options.map(o=>`<option value="${o}" ${o===selected?'selected':''}>${o}</option>`).join('')}</select>`;

// ============================================================
// MIGRATIONS
// ============================================================
const migrations = [
// HOTEL
`CREATE TABLE IF NOT EXISTS hotel_rooms(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,room_number VARCHAR(20) NOT NULL,room_type VARCHAR(50) NOT NULL DEFAULT 'Single',floor INTEGER DEFAULT 1,max_guests INTEGER DEFAULT 2,price_per_night NUMERIC(12,2) NOT NULL,amenities TEXT[],status VARCHAR(20) DEFAULT 'available',description TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS hotel_reservations(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,guest_name VARCHAR(255) NOT NULL,guest_email VARCHAR(255),guest_phone VARCHAR(20),room_id INTEGER REFERENCES hotel_rooms(id),check_in DATE NOT NULL,check_out DATE NOT NULL,num_guests INTEGER DEFAULT 1,total_amount NUMERIC(12,2),payment_status VARCHAR(20) DEFAULT 'pending',status VARCHAR(20) DEFAULT 'confirmed',source VARCHAR(50) DEFAULT 'walk_in',notes TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS hotel_housekeeping(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,room_id INTEGER REFERENCES hotel_rooms(id),task_type VARCHAR(50) NOT NULL,status VARCHAR(20) DEFAULT 'pending',assigned_to VARCHAR(255),notes TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`,
// RESTAURANT
`CREATE TABLE IF NOT EXISTS restaurant_menu_items(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,category VARCHAR(50) NOT NULL DEFAULT 'Mains',name VARCHAR(255) NOT NULL,description TEXT,price NUMERIC(10,2) NOT NULL,is_available BOOLEAN DEFAULT true,preparation_time INTEGER DEFAULT 15,created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS restaurant_tables(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,table_number VARCHAR(20) NOT NULL,capacity INTEGER DEFAULT 4,area VARCHAR(50) DEFAULT 'indoor',status VARCHAR(20) DEFAULT 'available',created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS restaurant_orders(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,table_id INTEGER REFERENCES restaurant_tables(id),order_type VARCHAR(20) DEFAULT 'dine_in',customer_name VARCHAR(255),status VARCHAR(20) DEFAULT 'pending',waiter VARCHAR(255),total_amount NUMERIC(12,2),payment_method VARCHAR(50),notes TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS restaurant_order_items(id SERIAL PRIMARY KEY,order_id INTEGER REFERENCES restaurant_orders(id) ON DELETE CASCADE,item_name VARCHAR(255),quantity INTEGER NOT NULL,unit_price NUMERIC(10,2),status VARCHAR(20) DEFAULT 'pending')`,
// RETAIL
`CREATE TABLE IF NOT EXISTS retail_products(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,name VARCHAR(255) NOT NULL,category VARCHAR(100),brand VARCHAR(100),sku VARCHAR(50),cost_price NUMERIC(12,2),selling_price NUMERIC(12,2) NOT NULL,stock_quantity INTEGER DEFAULT 0,min_stock INTEGER DEFAULT 5,supplier VARCHAR(255),is_active BOOLEAN DEFAULT true,created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS retail_sales(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,receipt_number VARCHAR(50),customer_name VARCHAR(255),payment_method VARCHAR(50),total_amount NUMERIC(12,2),status VARCHAR(20) DEFAULT 'completed',created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS retail_sale_items(id SERIAL PRIMARY KEY,sale_id INTEGER REFERENCES retail_sales(id) ON DELETE CASCADE,product_name VARCHAR(255),quantity INTEGER NOT NULL,unit_price NUMERIC(12,2))`,
// SALON
`CREATE TABLE IF NOT EXISTS salon_services(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,name VARCHAR(255) NOT NULL,category VARCHAR(50) DEFAULT 'Haircut',duration_minutes INTEGER NOT NULL,price NUMERIC(10,2) NOT NULL,is_active BOOLEAN DEFAULT true,created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS salon_staff(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,name VARCHAR(255) NOT NULL,phone VARCHAR(20),specialization TEXT[],commission_rate NUMERIC(5,2) DEFAULT 30,is_available BOOLEAN DEFAULT true,created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS salon_appointments(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,client_name VARCHAR(255) NOT NULL,client_phone VARCHAR(20),staff_id INTEGER REFERENCES salon_staff(id),service_id INTEGER REFERENCES salon_services(id),date DATE NOT NULL,start_time TIME NOT NULL,status VARCHAR(20) DEFAULT 'booked',price NUMERIC(10,2),notes TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`,
// PHARMACY
`CREATE TABLE IF NOT EXISTS pharmacy_drugs(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,name VARCHAR(255) NOT NULL,generic_name VARCHAR(255),category VARCHAR(100) DEFAULT 'Other',manufacturer VARCHAR(255),batch_number VARCHAR(100),expiry_date DATE,selling_price NUMERIC(10,2) NOT NULL,cost_price NUMERIC(10,2),stock_quantity INTEGER DEFAULT 0,min_stock INTEGER DEFAULT 20,dosage_form VARCHAR(50) DEFAULT 'Tablet',strength VARCHAR(100),requires_prescription BOOLEAN DEFAULT false,created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS pharmacy_sales(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,prescription_number VARCHAR(50),customer_name VARCHAR(255),customer_phone VARCHAR(20),total_amount NUMERIC(12,2),payment_method VARCHAR(50),status VARCHAR(20) DEFAULT 'completed',created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS pharmacy_sale_items(id SERIAL PRIMARY KEY,sale_id INTEGER REFERENCES pharmacy_sales(id) ON DELETE CASCADE,drug_name VARCHAR(255),quantity INTEGER NOT NULL,unit_price NUMERIC(10,2),instructions TEXT)`,
// GYM
`CREATE TABLE IF NOT EXISTS gym_memberships(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,plan_name VARCHAR(100) NOT NULL,duration_days INTEGER NOT NULL,price NUMERIC(10,2),features TEXT[],created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS gym_members(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,name VARCHAR(255) NOT NULL,email VARCHAR(255),phone VARCHAR(20),membership_id INTEGER REFERENCES gym_memberships(id),start_date DATE,end_date DATE,status VARCHAR(20) DEFAULT 'active',emergency_contact VARCHAR(255),created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS gym_check_ins(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,member_id INTEGER REFERENCES gym_members(id),check_in_time TIMESTAMPTZ DEFAULT NOW())`,
// HARDWARE
`CREATE TABLE IF NOT EXISTS hardware_products(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,name VARCHAR(255) NOT NULL,category VARCHAR(100) DEFAULT 'Other',brand VARCHAR(100),unit VARCHAR(50) DEFAULT 'Piece',cost_price NUMERIC(12,2),selling_price NUMERIC(12,2),stock_quantity NUMERIC(12,2) DEFAULT 0,supplier VARCHAR(255),created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS hardware_quotations(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,quotation_number VARCHAR(50),customer_name VARCHAR(255) NOT NULL,customer_phone VARCHAR(20),project_name VARCHAR(255),status VARCHAR(20) DEFAULT 'draft',total_amount NUMERIC(12,2),notes TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS hardware_quotation_items(id SERIAL PRIMARY KEY,quotation_id INTEGER REFERENCES hardware_quotations(id) ON DELETE CASCADE,product_name VARCHAR(255),quantity NUMERIC(12,2),unit_price NUMERIC(12,2),total NUMERIC(12,2))`,
// SUPERMARKET
`CREATE TABLE IF NOT EXISTS supermarket_products(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,name VARCHAR(255) NOT NULL,category VARCHAR(100) DEFAULT 'Other',brand VARCHAR(100),unit VARCHAR(50),cost_price NUMERIC(12,2),selling_price NUMERIC(12,2),stock_quantity NUMERIC(12,2) DEFAULT 0,min_stock NUMERIC(12,2) DEFAULT 10,is_perishable BOOLEAN DEFAULT false,shelf_life_days INTEGER,supplier VARCHAR(255),created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS supermarket_daily_sales(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,total_sales NUMERIC(12,2),total_items INTEGER,total_transactions INTEGER,date DATE DEFAULT CURRENT_DATE)`,
// TRANSPORT
`CREATE TABLE IF NOT EXISTS transport_fleet(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,vehicle_number VARCHAR(50) NOT NULL,vehicle_type VARCHAR(50) DEFAULT 'Taxi',make VARCHAR(100),model VARCHAR(100),capacity INTEGER,status VARCHAR(20) DEFAULT 'active',next_service_date DATE,created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS transport_bookings(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,customer_name VARCHAR(255),customer_phone VARCHAR(20),vehicle_id INTEGER REFERENCES transport_fleet(id),pickup_location TEXT NOT NULL,drop_off_location TEXT NOT NULL,scheduled_date DATE,fare NUMERIC(10,2),status VARCHAR(20) DEFAULT 'booked',driver_name VARCHAR(255),payment_status VARCHAR(20) DEFAULT 'pending',created_at TIMESTAMPTZ DEFAULT NOW())`,
// ELECTRONICS
`CREATE TABLE IF NOT EXISTS electronics_products(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,name VARCHAR(255) NOT NULL,brand VARCHAR(100),model VARCHAR(100),category VARCHAR(100) DEFAULT 'Other',serial_number VARCHAR(100),imei VARCHAR(50),cost_price NUMERIC(12,2),selling_price NUMERIC(12,2),stock INTEGER DEFAULT 1,warranty_months INTEGER DEFAULT 12,supplier VARCHAR(255),created_at TIMESTAMPTZ DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS electronics_repairs(id SERIAL PRIMARY KEY,tenant_id INTEGER NOT NULL,customer_name VARCHAR(255) NOT NULL,customer_phone VARCHAR(20),product_name VARCHAR(255),serial_number VARCHAR(100),issue TEXT NOT NULL,estimated_cost NUMERIC(10,2),repair_cost NUMERIC(10,2),status VARCHAR(20) DEFAULT 'received',technician VARCHAR(255),created_at TIMESTAMPTZ DEFAULT NOW())`,
];
(async()=>{for(const sql of migrations){try{await pool.query(sql);}catch(e){}}console.log('[BizSpec] Migrations complete');})();

// ============================================================
// 1. HOTEL
// ============================================================
app.get('/hotel/dashboard', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const rooms=(await pool.query('SELECT status,COUNT(*) as cnt FROM hotel_rooms WHERE tenant_id=$1 GROUP BY status',[tid])).rows;
  const stats={available:0,occupied:0,maintenance:0,reserved:0};rooms.forEach(r=>stats[r.status]=(stats[r.status]||0)+r.cnt);
  const today=new Date().toISOString().split('T')[0];
  const checkins=(await pool.query("SELECT COUNT(*) FROM hotel_reservations WHERE tenant_id=$1 AND check_in=$2 AND status='confirmed'",[tid,today])).rows[0].count;
  const checkouts=(await pool.query("SELECT COUNT(*) FROM hotel_reservations WHERE tenant_id=$1 AND check_out=$2 AND status='checked_in'",[tid,today])).rows[0].count;
  const revenue=(await pool.query("SELECT COALESCE(SUM(total_amount),0) as total FROM hotel_reservations WHERE tenant_id=$1 AND check_out=$2 AND status='checked_out'",[tid,today])).rows[0].total;
  const recent=(await pool.query('SELECT r.*,rm.room_number FROM hotel_reservations r LEFT JOIN hotel_rooms rm ON r.room_id=rm.id WHERE r.tenant_id=$1 ORDER BY r.created_at DESC LIMIT 10',[tid])).rows;
  res.send(renderPage('Hotel Dashboard',`<h2>🏨 Hotel Dashboard</h2>
  <div class="stats">${statCard('Available Rooms',stats.available,'#059669','🟢')}${statCard('Occupied',stats.occupied,'#dc2626','🔴')}${statCard('Today Check-ins',checkins,'#4f46e5','📋')}${statCard('Today Revenue','UGX '+Number(revenue).toLocaleString(),'#0891b2','💰')}</div>
  <div class="grid"><div class="card"><h3>Room Status</h3><div style="margin:16px 0">${SVG.donut(Object.entries(stats).map(([k,v])=>({label:k,value:v,color:k==='available'?'#059669':k==='occupied'?'#dc2626':k==='reserved'?'#f59e0b':'#64748b'})))}</div></div>
  <div class="card"><h3>Recent Reservations</h3><table><tr><th>Guest</th><th>Room</th><th>Check-in</th><th>Status</th></tr>${recent.map(r=>`<tr><td>${esc(r.guest_name)}</td><td>${r.room_number||'-'}</td><td>${r.check_in}</td><td><span class="tag">${r.status}</span></td></tr>`).join('')}</table></div></div>
  <div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap"><a href="/hotel/rooms" class="btn btn-primary">Manage Rooms</a><a href="/hotel/reservations" class="btn btn-primary">Reservations</a><a href="/hotel/housekeeping" class="btn btn-green">Housekeeping</a></div>`,req.session.user,req));
}));

app.get('/hotel/rooms', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const rooms=(await pool.query('SELECT * FROM hotel_rooms WHERE tenant_id=$1 ORDER BY room_number',[tid])).rows;
  res.send(renderPage('Hotel Rooms',`<h2>🏨 Rooms</h2>
  <div class="card"><h3>Add Room</h3><form method="POST" action="/hotel/rooms/add">
  <div class="grid"><div><label>Room Number</label><input name="room_number" required></div>
  <div><label>Type</label>${sel('room_type',['Single','Double','Twin','Suite','Deluxe','Family'])}</div>
  <div><label>Floor</label><input name="floor" type="number" value="1"></div>
  <div><label>Max Guests</label><input name="max_guests" type="number" value="2"></div>
  <div><label>Price/Night (UGX)</label><input name="price_per_night" type="number" required></div>
  <div><label>Status</label>${sel('status',['available','occupied','maintenance','reserved','cleaning'])}</div></div>
  <label>Description</label><textarea name="description" rows="2"></textarea>
  <button class="btn btn-primary" type="submit">Add Room</button></form></div>
  <div class="card"><h3>All Rooms (${rooms.length})</h3>
  <table><tr><th>Room</th><th>Type</th><th>Floor</th><th>Price</th><th>Status</th></tr>
  ${rooms.map(r=>`<tr><td><strong>${esc(r.room_number)}</strong></td><td>${r.room_type}</td><td>${r.floor}</td><td>UGX ${Number(r.price_per_night).toLocaleString()}</td><td><span class="tag" style="background:${r.status==='available'?'#d1fae5':r.status==='occupied'?'#fee2e2':'#fef3c7'}">${r.status}</span></td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/hotel/rooms/add', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const{room_number,room_type,floor,max_guests,price_per_night,description}=req.body;
  await pool.query('INSERT INTO hotel_rooms(tenant_id,room_number,room_type,floor,max_guests,price_per_night,description) VALUES($1,$2,$3,$4,$5,$6,$7)',[tid,room_number,room_type,floor||1,max_guests||2,price_per_night,description]);
  audit(req.session.user.email,'hotel_room_add','Added room '+room_number);res.redirect('/hotel/rooms');
}));

app.get('/hotel/reservations', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const resv=(await pool.query('SELECT r.*,rm.room_number FROM hotel_reservations r LEFT JOIN hotel_rooms rm ON r.room_id=rm.id WHERE r.tenant_id=$1 ORDER BY r.check_in DESC LIMIT 50',[tid])).rows;
  const rooms=(await pool.query('SELECT id,room_number,status FROM hotel_rooms WHERE tenant_id=$1 AND status=\'available\'',[tid])).rows;
  res.send(renderPage('Hotel Reservations',`<h2>📋 Reservations</h2>
  <div class="card"><h3>New Reservation</h3><form method="POST" action="/hotel/reservations/new">
  <div class="grid"><div><label>Guest Name</label><input name="guest_name" required></div>
  <div><label>Email</label><input name="guest_email" type="email"></div>
  <div><label>Phone</label><input name="guest_phone"></div>
  <div><label>Room</label><select name="room_id">${rooms.map(r=>`<option value="${r.id}">${r.room_number}</option>`).join('')}</select></div>
  <div><label>Check-in</label><input name="check_in" type="date" required></div>
  <div><label>Check-out</label><input name="check_out" type="date" required></div>
  <div><label>Guests</label><input name="num_guests" type="number" value="1"></div>
  <div><label>Source</label>${sel('source',['walk_in','online','phone','agent'])}</div></div>
  <label>Notes</label><textarea name="notes" rows="2"></textarea>
  <button class="btn btn-primary" type="submit">Book</button></form></div>
  <div class="card"><h3>All Reservations (${resv.length})</h3>
  <table><tr><th>Guest</th><th>Room</th><th>Check-in</th><th>Check-out</th><th>Amount</th><th>Status</th><th>Actions</th></tr>
  ${resv.map(r=>`<tr><td>${esc(r.guest_name)}</td><td>${r.room_number||'-'}</td><td>${r.check_in}</td><td>${r.check_out}</td><td>UGX ${Number(r.total_amount||0).toLocaleString()}</td><td><span class="tag">${r.status}</span></td>
  <td>${r.status==='confirmed'?`<form method="POST" action="/hotel/reservations/${r.id}/check-in" style="display:inline"><button class="btn btn-sm btn-green">Check In</button></form>`:''} ${r.status==='checked_in'?`<form method="POST" action="/hotel/reservations/${r.id}/check-out" style="display:inline"><button class="btn btn-sm btn-primary">Check Out</button></form>`:''}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/hotel/reservations/new', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const{guest_name,guest_email,guest_phone,room_id,check_in,check_out,num_guests,source,notes}=req.body;
  const room=(await pool.query('SELECT price_per_night FROM hotel_rooms WHERE id=$1 AND tenant_id=$2',[room_id,tid])).rows[0];
  const nights=Math.max(1,Math.ceil((new Date(check_out)-new Date(check_in))/(1000*60*60*24)));
  const total=room?room.price_per_night*nights:0;
  await pool.query('INSERT INTO hotel_reservations(tenant_id,guest_name,guest_email,guest_phone,room_id,check_in,check_out,num_guests,total_amount,source,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[tid,guest_name,guest_email,guest_phone,room_id,check_in,check_out,num_guests||1,total,source,notes]);
  await pool.query('UPDATE hotel_rooms SET status=\'reserved\' WHERE id=$1',[room_id]);
  audit(req.session.user.email,'hotel_reservation','New reservation for '+guest_name);res.redirect('/hotel/reservations');
}));

app.post('/hotel/reservations/:id/check-in', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  await pool.query("UPDATE hotel_reservations SET status='checked_in' WHERE id=$1 AND tenant_id=$2",[req.params.id,tid]);
  const rv=(await pool.query('SELECT room_id FROM hotel_reservations WHERE id=$1',[req.params.id])).rows[0];
  if(rv) await pool.query("UPDATE hotel_rooms SET status='occupied' WHERE id=$1",[rv.room_id]);
  audit(req.session.user.email,'hotel_checkin','Check-in reservation '+req.params.id);res.redirect('/hotel/reservations');
}));

app.post('/hotel/reservations/:id/check-out', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  await pool.query("UPDATE hotel_reservations SET status='checked_out',payment_status='paid' WHERE id=$1 AND tenant_id=$2",[req.params.id,tid]);
  const rv=(await pool.query('SELECT room_id FROM hotel_reservations WHERE id=$1',[req.params.id])).rows[0];
  if(rv) await pool.query("UPDATE hotel_rooms SET status='available' WHERE id=$1",[rv.room_id]);
  audit(req.session.user.email,'hotel_checkout','Check-out reservation '+req.params.id);res.redirect('/hotel/reservations');
}));

app.get('/hotel/housekeeping', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const tasks=(await pool.query('SELECT h.*,r.room_number FROM hotel_housekeeping h LEFT JOIN hotel_rooms r ON h.room_id=r.id WHERE h.tenant_id=$1 ORDER BY h.created_at DESC LIMIT 50',[tid])).rows;
  const rooms=(await pool.query('SELECT id,room_number FROM hotel_rooms WHERE tenant_id=$1',[tid])).rows;
  res.send(renderPage('Housekeeping',`<h2>🧹 Housekeeping</h2>
  <div class="card"><form method="POST" action="/hotel/housekeeping/add"><div class="grid">
  <div><label>Room</label><select name="room_id">${rooms.map(r=>`<option value="${r.id}">${r.room_number}</option>`).join('')}</select></div>
  <div><label>Task</label>${sel('task_type',['cleaning','maintenance','inspection','laundry'])}</div>
  <div><label>Assigned To</label><input name="assigned_to"></div></div>
  <label>Notes</label><textarea name="notes" rows="2"></textarea>
  <button class="btn btn-green" type="submit">Add Task</button></form></div>
  <div class="card"><table><tr><th>Room</th><th>Task</th><th>Status</th><th>Assigned</th><th>Actions</th></tr>
  ${tasks.map(t=>`<tr><td>${t.room_number||'-'}</td><td>${t.task_type}</td><td><span class="tag" style="background:${t.status==='completed'?'#d1fae5':t.status==='in_progress'?'#fef3c7':'#f1f5f9'}">${t.status}</span></td><td>${t.assigned_to||'-'}</td>
  <td>${t.status!=='completed'?`<form method="POST" action="/hotel/housekeeping/${t.id}/complete" style="display:inline"><button class="btn btn-sm btn-green">Done</button></form>`:''}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/hotel/housekeeping/add', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;await pool.query('INSERT INTO hotel_housekeeping(tenant_id,room_id,task_type,assigned_to,notes) VALUES($1,$2,$3,$4,$5)',[tid,req.body.room_id,req.body.task_type,req.body.assigned_to,req.body.notes]);
  res.redirect('/hotel/housekeeping');
}));

app.post('/hotel/housekeeping/:id/complete', requireAuth, ah(async(req,res)=>{
  await pool.query("UPDATE hotel_housekeeping SET status='completed' WHERE id=$1",[req.params.id]);res.redirect('/hotel/housekeeping');
}));

// ============================================================
// 2. RESTAURANT
// ============================================================
const MENU_CATS=['Starters','Mains','Drinks','Desserts','Sides','Specials'];

app.get('/restaurant/dashboard', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const today=new Date().toISOString().split('T')[0];
  const orders=(await pool.query("SELECT COUNT(*) as cnt,COALESCE(SUM(total_amount),0) as rev FROM restaurant_orders WHERE tenant_id=$1 AND DATE(created_at)=$2",[tid,today])).rows[0];
  const active=(await pool.query("SELECT COUNT(*) FROM restaurant_orders WHERE tenant_id=$1 AND status IN ('pending','preparing','ready')",[tid])).rows[0].count;
  const tables=(await pool.query("SELECT status,COUNT(*) as cnt FROM restaurant_tables WHERE tenant_id=$1 GROUP BY status",[tid])).rows;
  const topItems=(await pool.query("SELECT item_name,SUM(quantity) as qty FROM restaurant_order_items oi JOIN restaurant_orders o ON oi.order_id=o.id WHERE o.tenant_id=$1 AND DATE(o.created_at)=$2 GROUP BY item_name ORDER BY qty DESC LIMIT 5",[tid,today])).rows;
  res.send(renderPage('Restaurant Dashboard',`<h2>🍽️ Restaurant Dashboard</h2>
  <div class="stats">${statCard('Today Orders',orders.cnt,'#ea580c','📋')}${statCard('Today Revenue','UGX '+Number(orders.rev).toLocaleString(),'#059669','💰')}${statCard('Active Orders',active,'#4f46e5','⏳')}${statCard('Available Tables',tables.find(t=>t.status==='available')?.cnt||0,'#0891b2','🪑')}</div>
  <div class="grid"><div class="card"><h3>Top Items Today</h3>${topItems.length?SVG.bar(topItems.map(i=>({label:i.item_name,value:i.qty})),350,160,'#ea580c'):'<p class="muted">No orders yet today</p>'}</div>
  <div class="card"><h3>Table Status</h3>${SVG.donut(tables.map(t=>({label:t.status,value:t.cnt,color:t.status==='available'?'#059669':t.status==='occupied'?'#dc2626':'#f59e0b'})))}</div></div>
  <div style="margin-top:16px;display:flex;gap:12px"><a href="/restaurant/menu" class="btn btn-primary">Menu</a><a href="/restaurant/orders" class="btn btn-green">Orders</a><a href="/restaurant/kitchen" class="btn" style="background:#dc2626;color:white">Kitchen</a></div>`,req.session.user,req));
}));

app.get('/restaurant/menu', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const items=(await pool.query('SELECT * FROM restaurant_menu_items WHERE tenant_id=$1 ORDER BY category,name',[tid])).rows;
  const grouped={};items.forEach(i=>{(grouped[i.category]=grouped[i.category]||[]).push(i);});
  res.send(renderPage('Restaurant Menu',`<h2>📋 Menu Management</h2>
  <div class="card"><h3>Add Item</h3><form method="POST" action="/restaurant/menu/items/add"><div class="grid">
  <div><label>Name</label><input name="name" required></div>
  <div><label>Category</label>${sel('category',MENU_CATS)}</div>
  <div><label>Price (UGX)</label><input name="price" type="number" required></div>
  <div><label>Prep Time (min)</label><input name="preparation_time" type="number" value="15"></div></div>
  <label>Description</label><textarea name="description" rows="2"></textarea>
  <button class="btn btn-primary" type="submit">Add Item</button></form></div>
  ${Object.entries(grouped).map(([cat,list])=>`<div class="card"><h3>${cat} (${list.length})</h3>
  <table><tr><th>Name</th><th>Price</th><th>Prep</th><th>Available</th></tr>
  ${list.map(i=>`<tr><td>${esc(i.name)}</td><td>UGX ${Number(i.price).toLocaleString()}</td><td>${i.preparation_time}m</td><td><span class="tag" style="background:${i.is_available?'#d1fae5':'#fee2e2'}">${i.is_available?'Yes':'No'}</span></td></tr>`).join('')}</table></div>`).join('')}`,req.session.user,req));
}));

app.post('/restaurant/menu/items/add', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  await pool.query('INSERT INTO restaurant_menu_items(tenant_id,category,name,description,price,preparation_time) VALUES($1,$2,$3,$4,$5,$6)',[tid,req.body.category,req.body.name,req.body.description,req.body.price,req.body.preparation_time||15]);
  res.redirect('/restaurant/menu');
}));

app.get('/restaurant/orders', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const orders=(await pool.query('SELECT o.*,t.table_number FROM restaurant_orders o LEFT JOIN restaurant_tables t ON o.table_id=t.id WHERE o.tenant_id=$1 ORDER BY o.created_at DESC LIMIT 50',[tid])).rows;
  const tables=(await pool.query("SELECT id,table_number FROM restaurant_tables WHERE tenant_id=$1 AND status='available'",[tid])).rows;
  const menuItems=(await pool.query('SELECT id,name,price FROM restaurant_menu_items WHERE tenant_id=$1 AND is_available=true',[tid])).rows;
  res.send(renderPage('Restaurant Orders',`<h2>📋 Orders</h2>
  <div class="card"><h3>New Order</h3><form method="POST" action="/restaurant/orders/new"><div class="grid">
  <div><label>Type</label>${sel('order_type',['dine_in','take_away','delivery'])}</div>
  <div><label>Table</label><select name="table_id"><option value="">None</option>${tables.map(t=>`<option value="${t.id}">${t.table_number}</option>`).join('')}</select></div>
  <div><label>Customer</label><input name="customer_name"></div>
  <div><label>Payment</label>${sel('payment_method',['Cash','Mobile Money','Card'])}</div></div>
  <label>Items</label><div id="order-items"></div>
  <button type="button" class="btn btn-sm" onclick="addItem()">+ Add Item</button>
  <button class="btn btn-primary" type="submit">Place Order</button></form>
  <script>var mi=${JSON.stringify(menuItems.map(m=>({id:m.id,name:m.name,price:m.price})))};
  function addItem(){var c=document.getElementById('order-items');var d=document.createElement('div');d.style.cssText='display:flex;gap:8px;margin:4px 0';
  d.innerHTML='<select name="item_id">'+mi.map(function(m){return '<option value="'+m.id+'">'+m.name+' (UGX '+m.price+')</option>'})+'</select><input name="item_qty" type="number" value="1" min="1" style="width:60px"><input name="item_instructions" placeholder="Instructions" style="flex:1">';
  c.appendChild(d);}</script></div>
  <div class="card"><h3>Active Orders</h3><table><tr><th>#</th><th>Table</th><th>Type</th><th>Customer</th><th>Total</th><th>Status</th></tr>
  ${orders.map(o=>`<tr><td>${o.id}</td><td>${o.table_number||'-'}</td><td>${o.order_type}</td><td>${o.customer_name||'-'}</td><td>UGX ${Number(o.total_amount||0).toLocaleString()}</td><td><span class="tag" style="background:${o.status==='completed'?'#d1fae5':o.status==='ready'?'#dbeafe':'#fef3c7'}">${o.status}</span></td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/restaurant/orders/new', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const{order_type,customer_name,table_id,payment_method}=req.body;
  const itemIds=Array.isArray(req.body.item_id)?req.body.item_id:[req.body.item_id].filter(Boolean);
  const qtys=Array.isArray(req.body.item_qty)?req.body.item_qty:[req.body.item_qty];
  const instrs=Array.isArray(req.body.item_instructions)?req.body.item_instructions:[req.body.item_instructions];
  let total=0;
  const order=(await pool.query('INSERT INTO restaurant_orders(tenant_id,table_id,order_type,customer_name,total_amount,payment_method,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[tid,table_id||null,order_type,customer_name,0,payment_method,'pending'])).rows[0];
  for(let i=0;i<itemIds.length;i++){
    const mi=(await pool.query('SELECT name,price FROM restaurant_menu_items WHERE id=$1',[itemIds[i]])).rows[0];
    if(mi){const qty=parseInt(qtys[i])||1;const ip=mi.price*qty;total+=ip;
      await pool.query('INSERT INTO restaurant_order_items(order_id,item_name,quantity,unit_price) VALUES($1,$2,$3,$4)',[order.id,mi.name,qty,mi.price]);}
  }
  await pool.query('UPDATE restaurant_orders SET total_amount=$1 WHERE id=$2',[total,order.id]);
  if(table_id) await pool.query("UPDATE restaurant_tables SET status='occupied' WHERE id=$1",[table_id]);
  res.redirect('/restaurant/orders');
}));

app.get('/restaurant/kitchen', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const items=(await pool.query("SELECT oi.*,o.table_number,o.customer_name,o.id as order_id FROM restaurant_order_items oi JOIN restaurant_orders o ON oi.order_id=o.id WHERE o.tenant_id=$1 AND oi.status IN ('pending','preparing') ORDER BY o.created_at",[tid])).rows;
  const grouped={};items.forEach(i=>{(grouped[i.order_id]=grouped[i.order_id]||{table:i.table_number,customer:i.customer_name,items:[]});grouped[i.order_id].items.push(i);});
  res.send(renderPage('Kitchen Display',`<h2>🍳 Kitchen Display System</h2>
  <div class="grid">${Object.values(grouped).map(g=>`<div class="card" style="border-left:4px solid ${g.items.some(i=>i.status==='preparing')?'#f59e0b':'#dc2626'}">
  <div style="display:flex;justify-content:space-between;margin-bottom:12px"><h3>Order #${g.table||'T/A'}</h3><span class="tag">${g.customer||'Walk-in'}</span></div>
  ${g.items.map(i=>`<div style="padding:8px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between"><div><strong>${esc(i.item_name)}</strong> x${i.quantity}${i.instructions?' <span class="muted">('+esc(i.instructions)+')</span>':''}</div>
  <form method="POST" action="/restaurant/kitchen/${i.id}/ready" style="display:inline"><button class="btn btn-sm btn-green">Ready</button></form></div>`).join('')}</div>`).join('')}
  ${!items.length?'<div class="card" style="text-align:center;padding:40px"><p class="muted" style="font-size:32px">🎉</p><p>No pending items!</p></div>':''}</div>`,req.session.user,req));
}));

app.post('/restaurant/kitchen/:id/ready', requireAuth, ah(async(req,res)=>{
  await pool.query("UPDATE restaurant_order_items SET status='ready' WHERE id=$1",[req.params.id]);res.redirect('/restaurant/kitchen');
}));

// ============================================================
// 3. RETAIL SHOP / BOUTIQUE
// ============================================================
const RETAIL_CATS=['Electronics','Clothing','Food','Beverages','Beauty','Home','Sports','Stationery','Shoes','Accessories','Other'];

app.get('/retail/dashboard', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const today=new Date().toISOString().split('T')[0];
  const sales=(await pool.query("SELECT COUNT(*) as cnt,COALESCE(SUM(total_amount),0) as rev FROM retail_sales WHERE tenant_id=$1 AND DATE(created_at)=$2",[tid,today])).rows[0];
  const lowStock=(await pool.query("SELECT COUNT(*) FROM retail_products WHERE tenant_id=$1 AND stock_quantity<=min_stock AND is_active=true",[tid])).rows[0].count;
  const totalProducts=(await pool.query("SELECT COUNT(*),COALESCE(SUM(stock_quantity*selling_price),0) as val FROM retail_products WHERE tenant_id=$1 AND is_active=true",[tid])).rows[0];
  const topCat=(await pool.query("SELECT category,SUM(sale_items.quantity) as qty FROM retail_sale_items sale_items JOIN retail_sales s ON sale_items.sale_id=s.id JOIN retail_products p ON sale_items.product_name=p.name WHERE s.tenant_id=$1 GROUP BY category ORDER BY qty DESC LIMIT 6",[tid])).rows;
  res.send(renderPage('Retail Dashboard',`<h2>🛍️ Retail Dashboard</h2>
  <div class="stats">${statCard('Today Sales',sales.cnt,'#e11d48','📦')}${statCard('Today Revenue','UGX '+Number(sales.rev).toLocaleString(),'#059669','💰')}${statCard('Low Stock',lowStock,'#dc2626','⚠️')}${statCard('Products',totalProducts.count,'#4f46e5','🏷️')}</div>
  <div class="grid"><div class="card"><h3>Sales by Category</h3>${topCat.length?SVG.bar(topCat.map(c=>({label:c.category,value:c.qty})),350,160,'#e11d48'):'<p class="muted">No sales data yet</p>'}</div>
  <div class="card"><h3>Stock Value</h3><p style="font-size:28px;font-weight:800;color:#4f46e5;margin:20px 0">UGX ${Number(totalProducts.val||0).toLocaleString()}</p></div></div>
  <div style="margin-top:16px;display:flex;gap:12px"><a href="/retail/products" class="btn btn-primary">Products</a><a href="/retail/pos" class="btn btn-green">POS Terminal</a><a href="/retail/sales" class="btn" style="background:#e11d48;color:white">Sales History</a></div>`,req.session.user,req));
}));

app.get('/retail/products', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const products=(await pool.query('SELECT * FROM retail_products WHERE tenant_id=$1 AND is_active=true ORDER BY name',[tid])).rows;
  res.send(renderPage('Retail Products',`<h2>📦 Products (${products.length})</h2>
  <div class="card"><form method="POST" action="/retail/products/add"><div class="grid">
  <div><label>Name</label><input name="name" required></div>
  <div><label>Category</label>${sel('category',RETAIL_CATS)}</div>
  <div><label>Brand</label><input name="brand"></div>
  <div><label>SKU</label><input name="sku"></div>
  <div><label>Cost Price</label><input name="cost_price" type="number"></div>
  <div><label>Selling Price</label><input name="selling_price" type="number" required></div>
  <div><label>Stock Qty</label><input name="stock_quantity" type="number" value="0"></div>
  <div><label>Min Stock</label><input name="min_stock" type="number" value="5"></div>
  <div><label>Supplier</label><input name="supplier"></div></div>
  <button class="btn btn-primary" type="submit">Add Product</button></form></div>
  <div class="card"><table><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th></tr>
  ${products.map(p=>`<tr><td><strong>${esc(p.name)}</strong>${p.brand?' <span class="muted">'+esc(p.brand)+'</span>':''}</td><td>${p.category}</td><td>UGX ${Number(p.selling_price).toLocaleString()}</td><td style="color:${p.stock_quantity<=p.min_stock?'#dc2626':'#059669'};font-weight:700">${p.stock_quantity}</td><td>${p.stock_quantity<=p.min_stock?'<span class="tag" style="background:#fee2e2">Low</span>':'<span class="tag" style="background:#d1fae5">OK</span>'}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/retail/products/add', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const b=req.body;
  await pool.query('INSERT INTO retail_products(tenant_id,name,category,brand,sku,cost_price,selling_price,stock_quantity,min_stock,supplier) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[tid,b.name,b.category,b.brand,b.sku,b.cost_price,b.selling_price,b.stock_quantity||0,b.min_stock||5,b.supplier]);
  res.redirect('/retail/products');
}));

app.get('/retail/pos', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const products=(await pool.query('SELECT id,name,sku,selling_price,stock_quantity FROM retail_products WHERE tenant_id=$1 AND is_active=true AND stock_quantity>0 ORDER BY name',[tid])).rows;
  res.send(renderPage('POS Terminal',`<h2>💰 Point of Sale</h2>
  <div class="grid"><div class="card"><h3>Products</h3><input type="text" id="search" placeholder="Search products..." oninput="filterProducts()" style="margin-bottom:12px">
  <div id="plist" style="max-height:400px;overflow-y:auto">${products.map(p=>`<div class="prod-item" onclick="addToCart(${p.id},'${esc(p.name).replace(/'/g,"\\'")}',${p.selling_price})" style="padding:8px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;justify-content:space-between"><span>${esc(p.name)} <span class="muted">Stock: ${p.stock_quantity}</span></span><strong>UGX ${Number(p.selling_price).toLocaleString()}</strong></div>`).join('')}</div></div>
  <div class="card"><h3>Cart</h3><div id="cart"></div><div style="margin-top:16px;padding-top:12px;border-top:2px solid #e2e8f0"><strong>Total: UGX <span id="total">0</span></strong></div>
  <form method="POST" action="/retail/pos/checkout"><input type="hidden" name="items_json" id="items_json">
  <div><label>Customer</label><input name="customer_name" placeholder="Optional"></div>
  <div><label>Payment</label>${sel('payment_method',['Cash','Mobile Money','Card'])}</div>
  <button class="btn btn-green" type="submit" style="width:100%;margin-top:8px">Checkout</button></form></div></div>
  <script>var cart=[];
  function addToCart(id,name,price){var existing=cart.find(function(c){return c.id===id;});if(existing){existing.qty++;}else{cart.push({id:id,name:name,price:price,qty:1});}renderCart();}
  function renderCart(){var c=document.getElementById('cart');var t=0;c.innerHTML=cart.map(function(item,i){t+=item.price*item.qty;return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9"><span>'+item.name+' x'+item.qty+'</span><div><strong>UGX '+(item.price*item.qty).toLocaleString()+'</strong> <button onclick="removeFromCart('+i+')" style="background:none;border:none;color:red;cursor:pointer">✕</button></div></div>';}).join('');document.getElementById('total').textContent=t.toLocaleString();document.getElementById('items_json').value=JSON.stringify(cart);}
  function removeFromCart(i){cart.splice(i,1);renderCart();}
  function filterProducts(){var q=document.getElementById('search').value.toLowerCase();var items=document.querySelectorAll('.prod-item');items.forEach(function(el){el.style.display=el.textContent.toLowerCase().indexOf(q)!==-1?'':'none';});}
  </script>`,req.session.user,req));
}));

app.post('/retail/pos/checkout', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const items=JSON.parse(req.body.items_json||'[]');
  if(!items.length) return res.redirect('/retail/pos');
  let total=0;const receipt='RCP-'+Date.now().toString(36).toUpperCase();
  const sale=(await pool.query('INSERT INTO retail_sales(tenant_id,receipt_number,customer_name,payment_method,total_amount) VALUES($1,$2,$3,$4,$5) RETURNING id',[tid,receipt,req.body.customer_name,req.body.payment_method,0])).rows[0];
  for(const item of items){const ip=item.price*item.qty;total+=ip;
    await pool.query('INSERT INTO retail_sale_items(sale_id,product_name,quantity,unit_price) VALUES($1,$2,$3,$4)',[sale.id,item.name,item.qty,item.price]);
    await pool.query('UPDATE retail_products SET stock_quantity=stock_quantity-$1 WHERE id=$2 AND tenant_id=$3',[item.qty,item.id,tid]);
  }
  await pool.query('UPDATE retail_sales SET total_amount=$1 WHERE id=$2',[total,sale.id]);
  audit(req.session.user.email,'retail_sale','Receipt '+receipt+' UGX '+total);
  res.send(renderPage('Sale Complete',`<div class="card" style="text-align:center;max-width:400px;margin:40px auto"><div style="font-size:48px;margin-bottom:12px">✅</div><h2>Sale Complete!</h2><p style="font-size:14px;color:#64748b;margin-bottom:8px">Receipt: <strong>${receipt}</strong></p><p style="font-size:24px;font-weight:800;color:#059669">UGX ${total.toLocaleString()}</p><p style="font-size:14px;color:#64748b;margin:12px 0">${items.length} item(s)</p><a href="/retail/pos" class="btn btn-primary">New Sale</a></div>`,req.session.user,req));
}));

app.get('/retail/sales', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const sales=(await pool.query('SELECT * FROM retail_sales WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50',[tid])).rows;
  res.send(renderPage('Sales History',`<h2>📊 Sales History</h2>
  <div class="card"><table><tr><th>Receipt</th><th>Customer</th><th>Payment</th><th>Total</th><th>Date</th></tr>
  ${sales.map(s=>`<tr><td>${s.receipt_number}</td><td>${s.customer_name||'Walk-in'}</td><td>${s.payment_method||'-'}</td><td><strong>UGX ${Number(s.total_amount).toLocaleString()}</strong></td><td>${new Date(s.created_at).toLocaleDateString()}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

// ============================================================
// 4. SALON
// ============================================================
const SALON_CATS=['Haircut','Beard','Manicure','Pedicure','Facial','Massage','Styling','Color','Treatment','Waxing','Bridal','Other'];

app.get('/salon/dashboard', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const today=new Date().toISOString().split('T')[0];
  const appts=(await pool.query("SELECT COUNT(*) as cnt FROM salon_appointments WHERE tenant_id=$1 AND date=$2",[tid,today])).rows[0];
  const revenue=(await pool.query("SELECT COALESCE(SUM(price),0) as total FROM salon_appointments WHERE tenant_id=$1 AND date=$2 AND status='completed'",[tid,today])).rows[0].total;
  const weekRevenue=(await pool.query("SELECT COALESCE(SUM(price),0) as total FROM salon_appointments WHERE tenant_id=$1 AND date>=CURRENT_DATE-7 AND status='completed'",[tid])).rows[0].total;
  const weekData=(await pool.query("SELECT date,SUM(price) as daily FROM salon_appointments WHERE tenant_id=$1 AND date>=CURRENT_DATE-6 AND status='completed' GROUP BY date ORDER BY date",[tid])).rows;
  res.send(renderPage('Salon Dashboard',`<h2>💇 Salon Dashboard</h2>
  <div class="stats">${statCard('Today Appointments',appts.cnt,'#db2777','📅')}${statCard('Today Revenue','UGX '+Number(revenue).toLocaleString(),'#059669','💰')}${statCard('Week Revenue','UGX '+Number(weekRevenue).toLocaleString(),'#4f46e5','📈')}</div>
  <div class="card"><h3>Revenue This Week</h3>${weekData.length?SVG.bar(weekData.map(d=>({label:new Date(d.date).toLocaleDateString('en',{weekday:'short'}),value:d.daily})),400,160,'#db2777'):'<p class="muted">No completed appointments this week</p>'}</div>
  <div style="margin-top:16px;display:flex;gap:12px"><a href="/salon/appointments" class="btn btn-primary">Appointments</a><a href="/salon/services" class="btn btn-green">Services</a></div>`,req.session.user,req));
}));

app.get('/salon/services', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const services=(await pool.query('SELECT * FROM salon_services WHERE tenant_id=$1 ORDER BY category,name',[tid])).rows;
  res.send(renderPage('Salon Services',`<h2>💇 Services (${services.length})</h2>
  <div class="card"><form method="POST" action="/salon/services/add"><div class="grid">
  <div><label>Name</label><input name="name" required></div>
  <div><label>Category</label>${sel('category',SALON_CATS)}</div>
  <div><label>Duration (min)</label><input name="duration_minutes" type="number" value="30" required></div>
  <div><label>Price (UGX)</label><input name="price" type="number" required></div></div>
  <button class="btn btn-primary" type="submit">Add Service</button></form></div>
  <div class="card"><table><tr><th>Name</th><th>Category</th><th>Duration</th><th>Price</th></tr>
  ${services.map(s=>`<tr><td>${esc(s.name)}</td><td>${s.category}</td><td>${s.duration_minutes} min</td><td>UGX ${Number(s.price).toLocaleString()}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/salon/services/add', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;await pool.query('INSERT INTO salon_services(tenant_id,name,category,duration_minutes,price) VALUES($1,$2,$3,$4,$5)',[tid,req.body.name,req.body.category,req.body.duration_minutes,req.body.price]);res.redirect('/salon/services');
}));

app.get('/salon/appointments', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const appts=(await pool.query('SELECT a.*,s.name as service_name,st.name as staff_name FROM salon_appointments a LEFT JOIN salon_services s ON a.service_id=s.id LEFT JOIN salon_staff st ON a.staff_id=st.id WHERE a.tenant_id=$1 ORDER BY a.date DESC,a.start_time LIMIT 50',[tid])).rows;
  const services=(await pool.query('SELECT id,name FROM salon_services WHERE tenant_id=$1 AND is_active=true',[tid])).rows;
  const staff=(await pool.query('SELECT id,name FROM salon_staff WHERE tenant_id=$1 AND is_available=true',[tid])).rows;
  res.send(renderPage('Appointments',`<h2>📅 Appointments</h2>
  <div class="card"><h3>Book Appointment</h3><form method="POST" action="/salon/appointments/book"><div class="grid">
  <div><label>Client Name</label><input name="client_name" required></div>
  <div><label>Phone</label><input name="client_phone"></div>
  <div><label>Staff</label><select name="staff_id"><option value="">Any</option>${staff.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}</select></div>
  <div><label>Service</label><select name="service_id" required>${services.map(s=>`<option value="${s.id}">${s.name} (UGX ${Number(s.price).toLocaleString()})</option>`).join('')}</select></div>
  <div><label>Date</label><input name="date" type="date" required></div>
  <div><label>Time</label><input name="start_time" type="time" required></div></div>
  <label>Notes</label><textarea name="notes" rows="2"></textarea>
  <button class="btn btn-primary" type="submit">Book</button></form></div>
  <div class="card"><table><tr><th>Client</th><th>Service</th><th>Staff</th><th>Date</th><th>Time</th><th>Status</th><th>Actions</th></tr>
  ${appts.map(a=>`<tr><td>${esc(a.client_name)}</td><td>${a.service_name||'-'}</td><td>${a.staff_name||'Any'}</td><td>${a.date}</td><td>${a.start_time}</td><td><span class="tag" style="background:${a.status==='completed'?'#d1fae5':a.status==='cancelled'?'#fee2e2':'#fef3c7'}">${a.status}</span></td>
  <td>${a.status!=='completed'&&a.status!=='cancelled'?`<form method="POST" action="/salon/appointments/${a.id}/complete" style="display:inline"><button class="btn btn-sm btn-green">Done</button></form>`:''}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/salon/appointments/book', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const b=req.body;
  const svc=(await pool.query('SELECT price FROM salon_services WHERE id=$1',[b.service_id])).rows[0];
  await pool.query('INSERT INTO salon_appointments(tenant_id,client_name,client_phone,staff_id,service_id,date,start_time,price,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[tid,b.client_name,b.client_phone,b.staff_id,b.service_id,b.date,b.start_time,svc?.price||0,b.notes]);
  res.redirect('/salon/appointments');
}));

app.post('/salon/appointments/:id/complete', requireAuth, ah(async(req,res)=>{
  await pool.query("UPDATE salon_appointments SET status='completed' WHERE id=$1",[req.params.id]);res.redirect('/salon/appointments');
}));

// ============================================================
// 5. PHARMACY
// ============================================================
const PHARM_CATS=['Antibiotics','Painkillers','Antimalarial','Vitamins','Antiretrovirals','Cardiovascular','Diabetes','Eye','Eardrops','Skin','Digestive','Respiratory','Other'];

app.get('/pharmacy/dashboard', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const today=new Date().toISOString().split('T')[0];
  const drugs=(await pool.query('SELECT COUNT(*) FROM pharmacy_drugs WHERE tenant_id=$1',[tid])).rows[0].count;
  const lowStock=(await pool.query('SELECT COUNT(*) FROM pharmacy_drugs WHERE tenant_id=$1 AND stock_quantity<=min_stock',[tid])).rows[0].count;
  const expiring=(await pool.query('SELECT COUNT(*) FROM pharmacy_drugs WHERE tenant_id=$1 AND expiry_date<=CURRENT_DATE+30 AND expiry_date>CURRENT_DATE',[tid])).rows[0].count;
  const sales=(await pool.query("SELECT COUNT(*),COALESCE(SUM(total_amount),0) as total FROM pharmacy_sales WHERE tenant_id=$1 AND DATE(created_at)=$2",[tid,today])).rows[0];
  res.send(renderPage('Pharmacy Dashboard',`<h2>💊 Pharmacy Dashboard</h2>
  <div class="stats">${statCard('Total Drugs',drugs,'#2563eb','💉')}${statCard('Low Stock',lowStock,'#dc2626','⚠️')}${statCard('Expiring Soon',expiring,'#f59e0b','📅')}${statCard('Today Sales',sales.count+' (UGX '+Number(sales.total).toLocaleString()+')','#059669','💰')}</div>
  <div style="margin-top:16px;display:flex;gap:12px"><a href="/pharmacy/drugs" class="btn btn-primary">Drug Inventory</a><a href="/pharmacy/sales" class="btn btn-green">Sales</a><a href="/pharmacy/expiry-alerts" class="btn" style="background:#f59e0b;color:white">Expiry Alerts</a></div>`,req.session.user,req));
}));

app.get('/pharmacy/drugs', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const drugs=(await pool.query('SELECT * FROM pharmacy_drugs WHERE tenant_id=$1 ORDER BY name',[tid])).rows;
  res.send(renderPage('Drug Inventory',`<h2>💊 Drugs (${drugs.length})</h2>
  <div class="card"><form method="POST" action="/pharmacy/drugs/add"><div class="grid">
  <div><label>Name</label><input name="name" required></div>
  <div><label>Generic Name</label><input name="generic_name"></div>
  <div><label>Category</label>${sel('category',PHARM_CATS)}</div>
  <div><label>Form</label>${sel('dosage_form',['Tablet','Capsule','Syrup','Injection','Cream','Inhaler','Drops','Ointment','Powder','Other'])}</div>
  <div><label>Strength</label><input name="strength"></div>
  <div><label>Stock</label><input name="stock_quantity" type="number" value="0"></div>
  <div><label>Min Stock</label><input name="min_stock" type="number" value="20"></div>
  <div><label>Selling Price</label><input name="selling_price" type="number" required></div>
  <div><label>Cost Price</label><input name="cost_price" type="number"></div>
  <div><label>Expiry Date</label><input name="expiry_date" type="date"></div></div>
  <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="requires_prescription"> Requires Prescription</label>
  <button class="btn btn-primary" type="submit">Add Drug</button></form></div>
  <div class="card"><table><tr><th>Name</th><th>Category</th><th>Stock</th><th>Price</th><th>Expiry</th><th>Rx</th></tr>
  ${drugs.map(d=>`<tr style="${d.stock_quantity<=d.min_stock?'background:#fef2f2':''}${d.expiry_date&&new Date(d.expiry_date)<=new Date(Date.now()+30*86400000)?';background:#fffbeb':''}"><td>${esc(d.name)} <span class="muted">${d.strength||''}</span></td><td>${d.category}</td><td style="font-weight:700;color:${d.stock_quantity<=d.min_stock?'#dc2626':'#059669'}">${d.stock_quantity}</td><td>UGX ${Number(d.selling_price).toLocaleString()}</td><td>${d.expiry_date||'-'}</td><td>${d.requires_prescription?'<span class="tag" style="background:#fee2e2">Rx</span>':''}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/pharmacy/drugs/add', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const b=req.body;
  await pool.query('INSERT INTO pharmacy_drugs(tenant_id,name,generic_name,category,manufacturer,batch_number,expiry_date,selling_price,cost_price,stock_quantity,min_stock,dosage_form,strength,requires_prescription) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[tid,b.name,b.generic_name,b.category,b.manufacturer,b.batch_number,b.expiry_date,b.selling_price,b.cost_price,b.stock_quantity||0,b.min_stock||20,b.dosage_form,b.strength,!!b.requires_prescription]);
  res.redirect('/pharmacy/drugs');
}));

app.get('/pharmacy/expiry-alerts', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const drugs=(await pool.query('SELECT * FROM pharmacy_drugs WHERE tenant_id=$1 AND expiry_date IS NOT NULL AND expiry_date<=CURRENT_DATE+90 ORDER BY expiry_date ASC',[tid])).rows;
  res.send(renderPage('Expiry Alerts',`<h2>📅 Expiry Alerts (${drugs.length})</h2>
  <div class="card"><table><tr><th>Drug</th><th>Category</th><th>Batch</th><th>Stock</th><th>Expiry Date</th><th>Days Left</th><th>Urgency</th></tr>
  ${drugs.map(d=>{const days=Math.ceil((new Date(d.expiry_date)-new Date())/(86400000));const urg=days<=0?'EXPIRED':days<=30?'CRITICAL':days<=60?'WARNING':'OK';
  return `<tr style="background:${urg==='EXPIRED'?'#fef2f2':urg==='CRITICAL'?'#fff7ed':'#fffbeb'}"><td>${esc(d.name)}</td><td>${d.category}</td><td>${d.batch_number||'-'}</td><td>${d.stock_quantity}</td><td>${d.expiry_date}</td><td><strong>${days<=0?'EXPIRED':days+' days'}</strong></td><td><span class="tag" style="background:${urg==='EXPIDED'?'#fee2e2':urg==='CRITICAL'?'#ffedd5':'#fef3c7'}">${urg}</span></td></tr>`;}).join('')}</table></div>`,req.session.user,req));
}));

app.get('/pharmacy/sales', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const sales=(await pool.query('SELECT * FROM pharmacy_sales WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50',[tid])).rows;
  res.send(renderPage('Pharmacy Sales',`<h2>📊 Sales History</h2>
  <div class="card"><table><tr><th>#</th><th>Customer</th><th>Prescription</th><th>Total</th><th>Payment</th><th>Date</th></tr>
  ${sales.map(s=>`<tr><td>${s.id}</td><td>${s.customer_name||'Walk-in'}</td><td>${s.prescription_number||'-'}</td><td><strong>UGX ${Number(s.total_amount).toLocaleString()}</strong></td><td>${s.payment_method||'-'}</td><td>${new Date(s.created_at).toLocaleDateString()}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

// ============================================================
// 6-10: GYM, HARDWARE, SUPERMARKET, TRANSPORT, ELECTRONICS
// ============================================================
// GYM
app.get('/gym/dashboard', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const active=(await pool.query("SELECT COUNT(*) FROM gym_members WHERE tenant_id=$1 AND status='active'",[tid])).rows[0].count;
  const todayCheckins=(await pool.query("SELECT COUNT(*) FROM gym_check_ins WHERE tenant_id=$1 AND DATE(check_in_time)=CURRENT_DATE",[tid])).rows[0].count;
  const expiring=(await pool.query("SELECT COUNT(*) FROM gym_members WHERE tenant_id=$1 AND status='active' AND end_date<=CURRENT_DATE+7",[tid])).rows[0].count;
  const monthRev=(await pool.query("SELECT COALESCE(SUM(p.price),0) FROM gym_members m JOIN gym_memberships p ON m.membership_id=p.id WHERE m.tenant_id=$1 AND m.start_date>=CURRENT_DATE-30",[tid])).rows[0].coalesce;
  res.send(renderPage('Gym Dashboard',`<h2>🏋️ Gym Dashboard</h2>
  <div class="stats">${statCard('Active Members',active,'#16a34a','👤')}${statCard('Today Check-ins',todayCheckins,'#4f46e5','✅')}${statCard('Expiring (7d)',expiring,'#f59e0b','⚠️')}${statCard('Month Revenue','UGX '+Number(monthRev).toLocaleString(),'#059669','💰')}</div>
  <div style="margin-top:16px;display:flex;gap:12px"><a href="/gym/members" class="btn btn-primary">Members</a><a href="/gym/memberships" class="btn btn-green">Plans</a></div>`,req.session.user,req));
}));

app.get('/gym/members', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const members=(await pool.query('SELECT m.*,p.plan_name FROM gym_members m LEFT JOIN gym_memberships p ON m.membership_id=p.id WHERE m.tenant_id=$1 ORDER BY m.created_at DESC',[tid])).rows;
  const plans=(await pool.query('SELECT * FROM gym_memberships WHERE tenant_id=$1',[tid])).rows;
  res.send(renderPage('Gym Members',`<h2>👤 Members (${members.length})</h2>
  <div class="card"><form method="POST" action="/gym/members/add"><div class="grid">
  <div><label>Name</label><input name="name" required></div>
  <div><label>Email</label><input name="email" type="email"></div>
  <div><label>Phone</label><input name="phone"></div>
  <div><label>Plan</label><select name="membership_id">${plans.map(p=>`<option value="${p.id}">${p.plan_name} (UGX ${Number(p.price).toLocaleString()})</option>`).join('')}</select></div>
  <div><label>Emergency Contact</label><input name="emergency_contact"></div></div>
  <button class="btn btn-primary" type="submit">Add Member</button></form></div>
  <div class="card"><table><tr><th>Name</th><th>Phone</th><th>Plan</th><th>Status</th><th>End Date</th></tr>
  ${members.map(m=>`<tr><td>${esc(m.name)}</td><td>${m.phone||'-'}</td><td>${m.plan_name||'-'}</td><td><span class="tag" style="background:${m.status==='active'?'#d1fae5':m.status==='expired'?'#fee2e2':'#f1f5f9'}">${m.status}</span></td><td>${m.end_date||'-'}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/gym/members/add', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const b=req.body;const plan=(await pool.query('SELECT duration_days FROM gym_memberships WHERE id=$1',[b.membership_id])).rows[0];
  const end=plan?new Date(Date.now()+plan.duration_days*86400000).toISOString().split('T')[0]:null;
  await pool.query('INSERT INTO gym_members(tenant_id,name,email,phone,membership_id,start_date,end_date,emergency_contact) VALUES($1,$2,$3,$4,$5,CURRENT_DATE,$6,$7)',[tid,b.name,b.email,b.phone,b.membership_id,end,b.emergency_contact]);
  res.redirect('/gym/members');
}));

app.get('/gym/memberships', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const plans=(await pool.query('SELECT * FROM gym_memberships WHERE tenant_id=$1',[tid])).rows;
  res.send(renderPage('Membership Plans',`<h2>📋 Plans</h2>
  <div class="card"><form method="POST" action="/gym/memberships/add"><div class="grid">
  <div><label>Plan Name</label><input name="plan_name" required></div>
  <div><label>Duration (days)</label><input name="duration_days" type="number" value="30" required></div>
  <div><label>Price (UGX)</label><input name="price" type="number" required></div></div>
  <button class="btn btn-primary" type="submit">Add Plan</button></form></div>
  <div class="card"><table><tr><th>Plan</th><th>Duration</th><th>Price</th></tr>
  ${plans.map(p=>`<tr><td>${esc(p.plan_name)}</td><td>${p.duration_days} days</td><td>UGX ${Number(p.price).toLocaleString()}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/gym/memberships/add', requireAuth, ah(async(req,res)=>{
  await pool.query('INSERT INTO gym_memberships(tenant_id,plan_name,duration_days,price) VALUES($1,$2,$3,$4)',[req.session.user.tenant_id,req.body.plan_name,req.body.duration_days,req.body.price]);
  res.redirect('/gym/memberships');
}));

// HARDWARE, SUPERMARKET, TRANSPORT, ELECTRONICS — streamlined dashboards

app.get('/hardware/dashboard', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const count=(await pool.query('SELECT COUNT(*) FROM hardware_products WHERE tenant_id=$1',[tid])).rows[0].count;
  res.send(renderPage('Hardware Store Dashboard',`<h2>🔧 Hardware Store Dashboard</h2>
  <div class="stats">${statCard('Total Products',count,'#ca8a04','📦')}</div>
  <div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap"><a href="/hardware/products" class="btn btn-primary">Products</a><a href="/hardware/quotations" class="btn btn-green">Quotations</a></div>`,req.session.user,req));
}));

app.get('/hardware/products', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const HW_CATS=['Cement','Iron Sheets','Nails','Timber','Paint','Plumbing','Electrical','Tools','Tiles','Doors','Windows','Roofing','Sand','Bricks','Adhesive','Other'];
  const items=(await pool.query('SELECT * FROM hardware_products WHERE tenant_id=$1 ORDER BY name',[tid])).rows;
  res.send(renderPage('Hardware Products',`<h2>🔧 Products (${items.length})</h2>
  <div class="card"><form method="POST" action="/hardware/products/add"><div class="grid">
  <div><label>Name</label><input name="name" required></div><div><label>Category</label>${sel('category',HW_CATS)}</div>
  <div><label>Brand</label><input name="brand"></div><div><label>Unit</label>${sel('unit',['Bag','Piece','Kg','Meter','Liter','Roll','Box','Bundle','Sheet','Tube'])}</div>
  <div><label>Cost Price</label><input name="cost_price" type="number"></div><div><label>Selling Price</label><input name="selling_price" type="number" required></div>
  <div><label>Stock</label><input name="stock_quantity" type="number" value="0"></div><div><label>Supplier</label><input name="supplier"></div></div>
  <button class="btn btn-primary" type="submit">Add</button></form></div>
  <div class="card"><table><tr><th>Name</th><th>Category</th><th>Unit</th><th>Price</th><th>Stock</th></tr>
  ${items.map(i=>`<tr><td>${esc(i.name)}</td><td>${i.category}</td><td>${i.unit}</td><td>UGX ${Number(i.selling_price).toLocaleString()}</td><td>${i.stock_quantity}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/hardware/products/add', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const b=req.body;
  await pool.query('INSERT INTO hardware_products(tenant_id,name,category,brand,unit,cost_price,selling_price,stock_quantity,supplier) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[tid,b.name,b.category,b.brand,b.unit,b.cost_price,b.selling_price,b.stock_quantity||0,b.supplier]);res.redirect('/hardware/products');
}));

app.get('/hardware/quotations', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const quotes=(await pool.query('SELECT * FROM hardware_quotations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50',[tid])).rows;
  res.send(renderPage('Quotations',`<h2>📋 Quotations (${quotes.length})</h2><div class="card"><table><tr><th>#</th><th>Customer</th><th>Project</th><th>Total</th><th>Status</th></tr>
  ${quotes.map(q=>`<tr><td>${q.quotation_number}</td><td>${esc(q.customer_name)}</td><td>${q.project_name||'-'}</td><td>UGX ${Number(q.total_amount||0).toLocaleString()}</td><td><span class="tag">${q.status}</span></td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.get('/supermarket/dashboard', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const count=(await pool.query('SELECT COUNT(*) FROM supermarket_products WHERE tenant_id=$1',[tid])).rows[0].count;
  res.send(renderPage('Supermarket Dashboard',`<h2>🛒 Supermarket Dashboard</h2>
  <div class="stats">${statCard('Total Products',count,'#0d9488','📦')}</div>
  <div style="margin-top:16px"><a href="/supermarket/products" class="btn btn-primary">Products</a></div>`,req.session.user,req));
}));

app.get('/supermarket/products', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const SM_CATS=['Produce','Dairy','Meat','Bakery','Beverages','Household','PersonalCare','Frozen','Snacks','Cleaning','Baby','Health','Other'];
  const items=(await pool.query('SELECT * FROM supermarket_products WHERE tenant_id=$1 ORDER BY name',[tid])).rows;
  res.send(renderPage('Supermarket Products',`<h2>🛒 Products (${items.length})</h2>
  <div class="card"><form method="POST" action="/supermarket/products/add"><div class="grid">
  <div><label>Name</label><input name="name" required></div><div><label>Category</label>${sel('category',SM_CATS)}</div>
  <div><label>Brand</label><input name="brand"></div><div><label>Unit</label><input name="unit"></div>
  <div><label>Selling Price</label><input name="selling_price" type="number" required></div><div><label>Stock</label><input name="stock_quantity" type="number" value="0"></div>
  <div><label>Min Stock</label><input name="min_stock" type="number" value="10"></div><div><label>Perishable</label><select name="is_perishable"><option value="false">No</option><option value="true">Yes</option></select></div></div>
  <button class="btn btn-primary" type="submit">Add</button></form></div>
  <div class="card"><table><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Perishable</th></tr>
  ${items.map(i=>`<tr><td>${esc(i.name)}</td><td>${i.category}</td><td>UGX ${Number(i.selling_price).toLocaleString()}</td><td>${i.stock_quantity}</td><td>${i.is_perishable?'<span class="tag" style="background:#ffedd5">Yes</span>':''}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/supermarket/products/add', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const b=req.body;
  await pool.query('INSERT INTO supermarket_products(tenant_id,name,category,brand,unit,selling_price,stock_quantity,min_stock,is_perishable) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[tid,b.name,b.category,b.brand,b.unit,b.selling_price,b.stock_quantity||0,b.min_stock||10,b.is_perishable==='true']);res.redirect('/supermarket/products');
}));

app.get('/transport/dashboard', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const count=(await pool.query('SELECT COUNT(*) FROM transport_fleet WHERE tenant_id=$1',[tid])).rows[0].count;
  res.send(renderPage('Transport Dashboard',`<h2>🚗 Transport & Logistics Dashboard</h2>
  <div class="stats">${statCard('Total Vehicles',count,'#4f46e5','🚗')}</div>
  <div style="margin-top:16px;display:flex;gap:12px"><a href="/transport/fleet" class="btn btn-primary">Fleet</a><a href="/transport/bookings" class="btn btn-green">Bookings</a></div>`,req.session.user,req));
}));

app.get('/transport/fleet', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const items=(await pool.query('SELECT * FROM transport_fleet WHERE tenant_id=$1 ORDER BY vehicle_number',[tid])).rows;
  res.send(renderPage('Fleet Management',`<h2>🚗 Fleet (${items.length})</h2>
  <div class="card"><form method="POST" action="/transport/fleet/add"><div class="grid">
  <div><label>Vehicle Number</label><input name="vehicle_number" required></div>
  <div><label>Type</label>${sel('vehicle_type',['Bus','Taxi','Truck','Van','Motorcycle','Bodaboda','Car','Pickup','Trailer'])}</div>
  <div><label>Make</label><input name="make"></div><div><label>Model</label><input name="model"></div>
  <div><label>Capacity</label><input name="capacity" type="number"></div><div><label>Next Service</label><input name="next_service_date" type="date"></div></div>
  <button class="btn btn-primary" type="submit">Add Vehicle</button></form></div>
  <div class="card"><table><tr><th>Number</th><th>Type</th><th>Make/Model</th><th>Capacity</th><th>Status</th></tr>
  ${items.map(i=>`<tr><td><strong>${esc(i.vehicle_number)}</strong></td><td>${i.vehicle_type}</td><td>${i.make||''} ${i.model||''}</td><td>${i.capacity||'-'}</td><td><span class="tag" style="background:${i.status==='active'?'#d1fae5':'#fee2e2'}">${i.status}</span></td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/transport/fleet/add', requireAuth, ah(async(req,res)=>{
  await pool.query('INSERT INTO transport_fleet(tenant_id,vehicle_number,vehicle_type,make,model,capacity,next_service_date) VALUES($1,$2,$3,$4,$5,$6,$7)',[req.session.user.tenant_id,req.body.vehicle_number,req.body.vehicle_type,req.body.make,req.body.model,req.body.capacity,req.body.next_service_date]);
  res.redirect('/transport/fleet');
}));

app.get('/transport/bookings', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const bookings=(await pool.query('SELECT b.*,f.vehicle_number FROM transport_bookings b LEFT JOIN transport_fleet f ON b.vehicle_id=f.id WHERE b.tenant_id=$1 ORDER BY b.created_at DESC LIMIT 50',[tid])).rows;
  const vehicles=(await pool.query("SELECT id,vehicle_number FROM transport_fleet WHERE tenant_id=$1 AND status='active'",[tid])).rows;
  res.send(renderPage('Transport Bookings',`<h2>📋 Bookings</h2>
  <div class="card"><form method="POST" action="/transport/bookings/new"><div class="grid">
  <div><label>Customer Name</label><input name="customer_name" required></div><div><label>Phone</label><input name="customer_phone"></div>
  <div><label>Vehicle</label><select name="vehicle_id">${vehicles.map(v=>`<option value="${v.id}">${v.vehicle_number}</option>`).join('')}</select></div>
  <div><label>Pickup</label><input name="pickup_location" required></div><div><label>Drop-off</label><input name="drop_off_location" required></div>
  <div><label>Date</label><input name="scheduled_date" type="date" required></div><div><label>Fare (UGX)</label><input name="fare" type="number"></div></div>
  <button class="btn btn-primary" type="submit">Book</button></form></div>
  <div class="card"><table><tr><th>Customer</th><th>Vehicle</th><th>Route</th><th>Date</th><th>Fare</th><th>Status</th></tr>
  ${bookings.map(b=>`<tr><td>${esc(b.customer_name)}</td><td>${b.vehicle_number||'-'}</td><td>${b.pickup_location} → ${b.drop_off_location}</td><td>${b.scheduled_date}</td><td>UGX ${Number(b.fare||0).toLocaleString()}</td><td><span class="tag">${b.status}</span></td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/transport/bookings/new', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const b=req.body;
  await pool.query('INSERT INTO transport_bookings(tenant_id,customer_name,customer_phone,vehicle_id,pickup_location,drop_off_location,scheduled_date,fare) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[tid,b.customer_name,b.customer_phone,b.vehicle_id,b.pickup_location,b.drop_off_location,b.scheduled_date,b.fare]);
  res.redirect('/transport/bookings');
}));

app.get('/electronics/dashboard', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;
  const count=(await pool.query('SELECT COUNT(*) FROM electronics_products WHERE tenant_id=$1',[tid])).rows[0].count;
  const repairs=(await pool.query("SELECT COUNT(*) FROM electronics_repairs WHERE tenant_id=$1 AND status IN ('received','diagnosing','reparing')",[tid])).rows[0].count;
  res.send(renderPage('Electronics Dashboard',`<h2>📱 Electronics Shop Dashboard</h2>
  <div class="stats">${statCard('Products',count,'#6366f1','📦')}${statCard('Active Repairs',repairs,'#f59e0b','🔧')}</div>
  <div style="margin-top:16px;display:flex;gap:12px"><a href="/electronics/products" class="btn btn-primary">Products</a><a href="/electronics/repairs" class="btn btn-green">Repairs</a></div>`,req.session.user,req));
}));

app.get('/electronics/products', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const EL_CATS=['Phones','Laptops','TVs','Audio','Cameras','Accessories','Appliances','Gaming','Networking','Storage','Other'];
  const items=(await pool.query('SELECT * FROM electronics_products WHERE tenant_id=$1 ORDER BY name',[tid])).rows;
  res.send(renderPage('Electronics Products',`<h2>📱 Products (${items.length})</h2>
  <div class="card"><form method="POST" action="/electronics/products/add"><div class="grid">
  <div><label>Name</label><input name="name" required></div><div><label>Brand</label><input name="brand"></div><div><label>Model</label><input name="model"></div>
  <div><label>Category</label>${sel('category',EL_CATS)}</div><div><label>Serial Number</label><input name="serial_number"></div>
  <div><label>IMEI</label><input name="imei"></div><div><label>Selling Price</label><input name="selling_price" type="number" required></div>
  <div><label>Cost Price</label><input name="cost_price" type="number"></div><div><label>Stock</label><input name="stock" type="number" value="1"></div>
  <div><label>Warranty (months)</label><input name="warranty_months" type="number" value="12"></div></div>
  <button class="btn btn-primary" type="submit">Add</button></form></div>
  <div class="card"><table><tr><th>Name</th><th>Brand</th><th>Category</th><th>Serial</th><th>Price</th><th>Stock</th></tr>
  ${items.map(i=>`<tr><td>${esc(i.name)}</td><td>${i.brand||'-'}</td><td>${i.category}</td><td>${i.serial_number||'-'}</td><td>UGX ${Number(i.selling_price).toLocaleString()}</td><td>${i.stock}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/electronics/products/add', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const b=req.body;
  await pool.query('INSERT INTO electronics_products(tenant_id,name,brand,model,category,serial_number,imei,cost_price,selling_price,stock,warranty_months) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[tid,b.name,b.brand,b.model,b.category,b.serial_number,b.imei,b.cost_price,b.selling_price,b.stock||1,b.warranty_months||12]);
  res.redirect('/electronics/products');
}));

app.get('/electronics/repairs', requireAuth, ah(async(req,res)=>{
  const tid=req.session.user.tenant_id;const repairs=(await pool.query('SELECT * FROM electronics_repairs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50',[tid])).rows;
  res.send(renderPage('Repair Jobs',`<h2>🔧 Repairs (${repairs.length})</h2>
  <div class="card"><form method="POST" action="/electronics/repairs/new"><div class="grid">
  <div><label>Customer Name</label><input name="customer_name" required></div><div><label>Phone</label><input name="customer_phone"></div>
  <div><label>Product</label><input name="product_name" required></div><div><label>Serial Number</label><input name="serial_number"></div></div>
  <label>Issue</label><textarea name="issue" required rows="3"></textarea>
  <div class="grid"><div><label>Est. Cost</label><input name="estimated_cost" type="number"></div><div><label>Technician</label><input name="technician"></div></div>
  <button class="btn btn-primary" type="submit">Create Repair Job</button></form></div>
  <div class="card"><table><tr><th>Customer</th><th>Product</th><th>Issue</th><th>Status</th><th>Technician</th><th>Date</th></tr>
  ${repairs.map(r=>`<tr><td>${esc(r.customer_name)}</td><td>${esc(r.product_name)}</td><td>${(r.issue||'').substring(0,40)}</td><td><span class="tag" style="background:${r.status==='ready'?'#d1fae5':r.status==='reparing'?'#dbeafe':'#f1f5f9'}">${r.status}</span></td><td>${r.technician||'-'}</td><td>${new Date(r.created_at).toLocaleDateString()}</td></tr>`).join('')}</table></div>`,req.session.user,req));
}));

app.post('/electronics/repairs/new', requireAuth, ah(async(req,res)=>{
  await pool.query('INSERT INTO electronics_repairs(tenant_id,customer_name,customer_phone,product_name,serial_number,issue,estimated_cost,technician) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[req.session.user.tenant_id,req.body.customer_name,req.body.customer_phone,req.body.product_name,req.body.serial_number,req.body.issue,req.body.estimated_cost,req.body.technician]);
  res.redirect('/electronics/repairs');
}));

console.log('[BizSpec] All 10 business specializations loaded');
};
