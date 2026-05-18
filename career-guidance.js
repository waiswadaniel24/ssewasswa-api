module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const C = '#4f46e5';
  const CL = '#818cf8';
  const CBG = '#eef2ff';
  const CTEXTC = '#1e1b4b';
  const CTEXTM = '#6b7280';
  const CSUCCESS = '#059669';
  const CWARN = '#d97706';
  const CDANGER = '#dc2626';
  const CBG2 = '#f9fafb';

  // ─── Section & Interest Data ──────────────────────────────────────
  const SECTIONS = [
    { key: 'logical', label: 'Logical Reasoning', icon: '🧩', timeLimit: 300 },
    { key: 'verbal', label: 'Verbal Ability', icon: '📖', timeLimit: 300 },
    { key: 'numerical', label: 'Numerical Aptitude', icon: '🔢', timeLimit: 300 },
    { key: 'spatial', label: 'Spatial Reasoning', icon: '📐', timeLimit: 300 },
    { key: 'mechanical', label: 'Mechanical Comprehension', icon: '⚙️', timeLimit: 300 },
    { key: 'creative', label: 'Creative Thinking', icon: '🎨', timeLimit: 300 }
  ];

  const APTITUDE_QUESTIONS = [
    // Logical Reasoning (5)
    { section:'logical', q:'If all roses are flowers and some flowers fade quickly, then:', opts:['All roses fade quickly','Some roses may fade quickly','No roses fade quickly','Flowers are not roses'], correct:1 },
    { section:'logical', q:'Complete the series: 2, 6, 18, 54, ?', opts:['108','162','148','128'], correct:1 },
    { section:'logical', q:'If A > B, B > C, and C > D, which is true?', opts:['D > A','A > D','B < D','C > A'], correct:1 },
    { section:'logical', q:'In a race you overtake the 2nd person. What position are you now in?', opts:['1st','2nd','3rd','4th'], correct:1 },
    { section:'logical', q:'Which number does not belong: 2, 5, 10, 17, 28, 37?', opts:['28','10','17','5'], correct:0 },
    // Verbal Ability (5)
    { section:'verbal', q:'Choose the synonym of "Eloquent":', opts:['Silent','Articulate','Clumsy','Vague'], correct:1 },
    { section:'verbal', q:'Choose the antonym of "Benevolent":', opts:['Kind','Generous','Malevolent','Gentle'], correct:2 },
    { section:'verbal', q:'"The ball is in your court" means:', opts:['A game is being played','It is your decision now','The court is reserved','The ball was lost'], correct:1 },
    { section:'verbal', q:'Complete: "She sings _____ than her sister."', opts:['more beautifully','beautifuler','most beautiful','beauty'], correct:0 },
    { section:'verbal', q:'Which word is spelled correctly?', opts:['Accomodate','Accommodate','Acommodate','Acomodate'], correct:1 },
    // Numerical Aptitude (5)
    { section:'numerical', q:'What is 15% of 240?', opts:['36','34','38','32'], correct:0 },
    { section:'numerical', q:'If a shirt costs $50 after a 20% discount, what was the original price?', opts:['$60','$62.50','$65','$55'], correct:1 },
    { section:'numerical', q:'What is the average of 12, 18, 24, and 30?', opts:['20','21','22','24'], correct:1 },
    { section:'numerical', q:'A train travels 360 km in 4 hours. What is its speed?', opts:['80 km/h','90 km/h','85 km/h','95 km/h'], correct:1 },
    { section:'numerical', q:'If 3x + 7 = 22, what is x?', opts:['3','4','5','6'], correct:2 },
    // Spatial Reasoning (5)
    { section:'spatial', q:'If you fold a square paper diagonally, what shape do you get?', opts:['Rectangle','Triangle','Pentagon','Hexagon'], correct:1 },
    { section:'spatial', q:'How many faces does a cube have?', opts:['4','6','8','12'], correct:1 },
    { section:'spatial', q:'A mirror reverses which dimension?', opts:['Top-bottom','Left-right','Both','Neither'], correct:1 },
    { section:'spatial', q:'How many edges does a triangular pyramid have?', opts:['4','5','6','8'], correct:2 },
    { section:'spatial', q:'If you rotate a "b" 180 degrees, what letter does it resemble?', opts:['d','p','q','g'], correct:2 },
    // Mechanical Comprehension (5)
    { section:'mechanical', q:'Which simple machine is a ramp an example of?', opts:['Lever','Pulley','Inclined plane','Wheel'], correct:2 },
    { section:'mechanical', q:'Gears with 10 and 20 teeth: the smaller gear turns how fast relative to the larger?', opts:['Half speed','Same speed','Twice as fast','Four times'], correct:2 },
    { section:'mechanical', q:'A lever with effort farther from the fulcrum than the load provides:', opts:['No advantage','Mechanical disadvantage','Mechanical advantage','Equal force'], correct:2 },
    { section:'mechanical', q:'What happens to air pressure as altitude increases?', opts:['Increases','Decreases','Stays the same','Fluctuates'], correct:1 },
    { section:'mechanical', q:'Which material is best for an electrical conductor?', opts:['Rubber','Wood','Copper','Glass'], correct:2 },
    // Creative Thinking (5)
    { section:'creative', q:'A paperclip can be used for all EXCEPT:', opts:['Holding paper','Picking locks','Emergency zipper pull','Cutting paper'], correct:3 },
    { section:'creative', q:'If you could only use circles and triangles, how would you draw a tree?', opts:['Triangle on a circle','Circle on a triangle','Overlapping circles','Stacked triangles'], correct:0 },
    { section:'creative', q:'Which combination creates the most innovative product idea?', opts:['Phone + Camera','Umbrella + Fan','Book + Light','Pen + Watch'], correct:1 },
    { section:'creative', q:'A "what if" question that sparks the most creative ideas:', opts:['What if it rained?','What if humans could fly?','What if 2+2=5?','What if birds swam?'], correct:1 },
    { section:'creative', q:'Lateral thinking means:', opts:['Linear step-by-step logic','Approaching problems from unusual angles','Memorizing facts','Following instructions exactly'], correct:1 }
  ];

  const INTERESTS = [
    { id:'i01', category:'Science', label:'Conducting laboratory experiments' },
    { id:'i02', category:'Science', label:'Studying stars and planets' },
    { id:'i03', category:'Science', label:'Researching human diseases' },
    { id:'i04', category:'Science', label:'Exploring marine biology' },
    { id:'i05', category:'Science', label:'Working with chemicals and reactions' },
    { id:'i06', category:'Technology', label:'Programming and software development' },
    { id:'i07', category:'Technology', label:'Building and fixing computers' },
    { id:'i08', category:'Technology', label:'Artificial intelligence and robotics' },
    { id:'i09', category:'Technology', label:'Cybersecurity and ethical hacking' },
    { id:'i10', category:'Technology', label:'Mobile app development' },
    { id:'i11', category:'Arts', label:'Drawing, painting, or sculpture' },
    { id:'i12', category:'Arts', label:'Playing a musical instrument' },
    { id:'i13', category:'Arts', label:'Photography and videography' },
    { id:'i14', category:'Arts', label:'Creative writing and poetry' },
    { id:'i15', category:'Arts', label:'Theater and performing arts' },
    { id:'i16', category:'Business', label:'Starting and running a business' },
    { id:'i17', category:'Business', label:'Marketing and advertising' },
    { id:'i18', category:'Business', label:'Stock markets and investments' },
    { id:'i19', category:'Business', label:'Sales and negotiation' },
    { id:'i20', category:'Business', label:'Financial planning and accounting' },
    { id:'i21', category:'Health', label:'Helping sick people recover' },
    { id:'i22', category:'Health', label:'Mental health and counseling' },
    { id:'i23', category:'Health', label:'Fitness and sports training' },
    { id:'i24', category:'Health', label:'Nutrition and diet planning' },
    { id:'i25', category:'Health', label:'Public health and epidemiology' },
    { id:'i26', category:'Engineering', label:'Designing buildings and structures' },
    { id:'i27', category:'Engineering', label:'Automobile and vehicle design' },
    { id:'i28', category:'Engineering', label:'Electronics and circuit design' },
    { id:'i29', category:'Engineering', label:'Environmental engineering' },
    { id:'i30', category:'Engineering', label:'Aerospace and aviation' },
    { id:'i31', category:'Social', label:'Teaching and mentoring others' },
    { id:'i32', category:'Social', label:'Social work and community service' },
    { id:'i33', category:'Social', label:'Law and justice' },
    { id:'i34', category:'Social', label:'Politics and governance' },
    { id:'i35', category:'Social', label:'Journalism and media' },
    { id:'i36', category:'Nature', label:'Wildlife conservation' },
    { id:'i37', category:'Nature', label:'Agriculture and farming' },
    { id:'i38', category:'Nature', label:'Forestry and botany' },
    { id:'i39', category:'Nature', label:'Climate change research' },
    { id:'i40', category:'Nature', label:'Geology and mining' }
  ];

  const CAREER_SEED = [
    { title:'Software Engineer', category:'Technology', description:'Design, develop, and maintain software systems and applications.', required_subjects:'Mathematics, Computer Science, Physics', education_level:'Bachelor\'s Degree', salary_range:'$60,000 - $150,000', skills_needed:'Programming, Problem-solving, Algorithm design, Teamwork', outlook:'Very High Growth' },
    { title:'Physician', category:'Health', description:'Diagnose and treat illnesses, prescribe medications, and manage patient care.', required_subjects:'Biology, Chemistry, Physics, Mathematics', education_level:'Doctor of Medicine (MD)', salary_range:'$200,000 - $400,000+', skills_needed:'Medical knowledge, Empathy, Critical thinking, Communication', outlook:'High Growth' },
    { title:'Civil Engineer', category:'Engineering', description:'Design and supervise construction of infrastructure like roads, bridges, and buildings.', required_subjects:'Mathematics, Physics, Chemistry', education_level:'Bachelor\'s Degree', salary_range:'$55,000 - $120,000', skills_needed:'Design, Project management, AutoCAD, Problem-solving', outlook:'Steady Growth' },
    { title:'Data Scientist', category:'Technology', description:'Analyze complex data to help organizations make informed decisions.', required_subjects:'Mathematics, Statistics, Computer Science', education_level:'Master\'s Degree', salary_range:'$85,000 - $170,000', skills_needed:'Statistics, Machine learning, Python/R, Data visualization', outlook:'Very High Growth' },
    { title:'Architect', category:'Engineering', description:'Plan and design buildings and other structures, balancing aesthetics and functionality.', required_subjects:'Mathematics, Physics, Art, Technical Drawing', education_level:'Bachelor\'s Degree + License', salary_range:'$50,000 - $130,000', skills_needed:'Design, Creativity, AutoCAD, Communication', outlook:'Moderate Growth' },
    { title:'Registered Nurse', category:'Health', description:'Provide patient care, administer medications, and assist doctors in medical procedures.', required_subjects:'Biology, Chemistry, Anatomy', education_level:'Associate/Bachelor\'s Degree', salary_range:'$45,000 - $95,000', skills_needed:'Patient care, Attention to detail, Empathy, Stamina', outlook:'Very High Growth' },
    { title:'Teacher', category:'Social', description:'Educate students in academic subjects and help them develop skills and knowledge.', required_subjects:'Varies by subject specialization', education_level:'Bachelor\'s Degree + Certification', salary_range:'$35,000 - $75,000', skills_needed:'Communication, Patience, Subject expertise, Classroom management', outlook:'Steady Growth' },
    { title:'Accountant', category:'Business', description:'Manage financial records, prepare taxes, and provide financial advice to organizations.', required_subjects:'Mathematics, Economics, Business Studies', education_level:'Bachelor\'s Degree', salary_range:'$45,000 - $90,000', skills_needed:'Numeracy, Attention to detail, Excel, Analytical thinking', outlook:'Steady Growth' },
    { title:'Mechanical Engineer', category:'Engineering', description:'Design, develop, and test mechanical devices and thermal sensors.', required_subjects:'Mathematics, Physics, Chemistry', education_level:'Bachelor\'s Degree', salary_range:'$55,000 - $120,000', skills_needed:'CAD, Thermodynamics, Problem-solving, Innovation', outlook:'Moderate Growth' },
    { title:'Graphic Designer', category:'Arts', description:'Create visual concepts and designs for brands, publications, and digital media.', required_subjects:'Art, Computer Studies, English', education_level:'Bachelor\'s Degree / Diploma', salary_range:'$35,000 - $80,000', skills_needed:'Adobe Creative Suite, Creativity, Typography, Color theory', outlook:'Moderate Growth' },
    { title:'Lawyer', category:'Social', description:'Represent clients in legal matters, draft legal documents, and provide legal advice.', required_subjects:'English, History, Social Studies, Government', education_level:'Juris Doctor (JD)', salary_range:'$60,000 - $180,000', skills_needed:'Research, Argumentation, Writing, Critical analysis', outlook:'Moderate Growth' },
    { title:'Psychologist', category:'Health', description:'Study human behavior and mental processes to help individuals with mental health.', required_subjects:'Biology, Psychology, Mathematics, English', education_level:'Master\'s/Doctorate', salary_range:'$50,000 - $120,000', skills_needed:'Empathy, Research, Analysis, Communication', outlook:'High Growth' },
    { title:'Environmental Scientist', category:'Nature', description:'Study environmental problems and develop solutions to protect natural resources.', required_subjects:'Biology, Chemistry, Geography, Mathematics', education_level:'Bachelor\'s/Master\'s Degree', salary_range:'$45,000 - $95,000', skills_needed:'Research, Data analysis, Field work, Report writing', outlook:'High Growth' },
    { title:'Electrical Engineer', category:'Engineering', description:'Design and develop electrical equipment, systems, and components.', required_subjects:'Mathematics, Physics, Chemistry', education_level:'Bachelor\'s Degree', salary_range:'$60,000 - $130,000', skills_needed:'Circuit design, Programming, Problem-solving, Mathematics', outlook:'Moderate Growth' },
    { title:'Marketing Manager', category:'Business', description:'Plan and execute marketing campaigns to promote products and services.', required_subjects:'Business Studies, English, Mathematics, Economics', education_level:'Bachelor\'s Degree', salary_range:'$55,000 - $130,000', skills_needed:'Communication, Strategy, Analytics, Creativity', outlook:'Steady Growth' },
    { title:'Journalist', category:'Social', description:'Research, write, and report news stories for print, digital, or broadcast media.', required_subjects:'English, History, Social Studies, Computer Studies', education_level:'Bachelor\'s Degree', salary_range:'$30,000 - $80,000', skills_needed:'Writing, Research, Interviewing, Objectivity', outlook:'Moderate Growth' },
    { title:'Pharmacist', category:'Health', description:'Dispense medications, advise patients on drug use, and ensure safe drug interactions.', required_subjects:'Chemistry, Biology, Mathematics, Physics', education_level:'Doctor of Pharmacy (PharmD)', salary_range:'$90,000 - $150,000', skills_needed:'Chemistry knowledge, Attention to detail, Communication, Ethics', outlook:'High Growth' },
    { title:'Aerospace Engineer', category:'Engineering', description:'Design aircraft, spacecraft, satellites, and missile systems.', required_subjects:'Mathematics, Physics, Chemistry, Computer Science', education_level:'Bachelor\'s/Master\'s Degree', salary_range:'$70,000 - $160,000', skills_needed:'Aerodynamics, CAD, Programming, Mathematics', outlook:'Moderate Growth' },
    { title:'Chef / Culinary Artist', category:'Arts', description:'Plan menus, prepare meals, and oversee kitchen operations in restaurants.', required_subjects:'Home Economics, Chemistry, Business Studies', education_level:'Culinary Degree / Diploma', salary_range:'$25,000 - $85,000', skills_needed:'Cooking techniques, Creativity, Time management, Leadership', outlook:'Steady Growth' },
    { title:'Financial Analyst', category:'Business', description:'Evaluate investment opportunities and provide financial guidance to businesses.', required_subjects:'Mathematics, Economics, Business Studies, Accounting', education_level:'Bachelor\'s Degree', salary_range:'$55,000 - $120,000', skills_needed:'Financial modeling, Excel, Analysis, Communication', outlook:'High Growth' },
    { title:'Veterinarian', category:'Health', description:'Diagnose and treat diseases and injuries in animals.', required_subjects:'Biology, Chemistry, Physics, Mathematics', education_level:'Doctor of Veterinary Medicine', salary_range:'$70,000 - $140,000', skills_needed:'Medical knowledge, Empathy, Manual dexterity, Business skills', outlook:'High Growth' },
    { title:'UX/UI Designer', category:'Technology', description:'Design user interfaces and experiences for websites and applications.', required_subjects:'Computer Studies, Art, Psychology', education_level:'Bachelor\'s Degree / Bootcamp', salary_range:'$50,000 - $120,000', skills_needed:'Figma, User research, Prototyping, Visual design', outlook:'Very High Growth' },
    { title:'Social Worker', category:'Social', description:'Help individuals and families cope with challenges and improve their well-being.', required_subjects:'Social Studies, Psychology, English, Biology', education_level:'Bachelor\'s/Master\'s Degree', salary_range:'$35,000 - $70,000', skills_needed:'Empathy, Communication, Crisis management, Advocacy', outlook:'High Growth' },
    { title:'Agricultural Scientist', category:'Nature', description:'Research ways to improve crop yields, soil health, and farming practices.', required_subjects:'Biology, Chemistry, Geography, Mathematics', education_level:'Bachelor\'s/Master\'s Degree', salary_range:'$50,000 - $100,000', skills_needed:'Research, Data analysis, Botany, Field studies', outlook:'High Growth' },
    { title:'Biomedical Engineer', category:'Engineering', description:'Design and create medical devices, prosthetics, and diagnostic equipment.', required_subjects:'Biology, Physics, Mathematics, Chemistry', education_level:'Bachelor\'s/Master\'s Degree', salary_range:'$60,000 - $130,000', skills_needed:'Engineering, Biology knowledge, Innovation, Problem-solving', outlook:'Very High Growth' },
    { title:'Musician / Composer', category:'Arts', description:'Create, perform, and record music for various audiences and media.', required_subjects:'Music, English, History', education_level:'Degree / Training / Self-taught', salary_range:'$25,000 - $120,000+', skills_needed:'Musical ability, Creativity, Performance, Collaboration', outlook:'Variable' },
    { title:'Cybersecurity Analyst', category:'Technology', description:'Protect organizations from cyber threats and security breaches.', required_subjects:'Computer Science, Mathematics, Physics', education_level:'Bachelor\'s Degree', salary_range:'$65,000 - $130,000', skills_needed:'Network security, Ethical hacking, Analysis, Programming', outlook:'Very High Growth' },
    { title:'Physical Therapist', category:'Health', description:'Help patients recover mobility and manage pain through exercise and treatment.', required_subjects:'Biology, Chemistry, Physics, Physical Education', education_level:'Doctor of Physical Therapy', salary_range:'$55,000 - $105,000', skills_needed:'Anatomy knowledge, Patience, Communication, Empathy', outlook:'Very High Growth' },
    { title:'Economist', category:'Business', description:'Analyze economic data and trends to advise governments and businesses.', required_subjects:'Mathematics, Economics, History, Statistics', education_level:'Master\'s/Doctorate', salary_range:'$60,000 - $140,000', skills_needed:'Statistical analysis, Research, Critical thinking, Communication', outlook:'Moderate Growth' },
    { title:'Interior Designer', category:'Arts', description:'Plan and design interior spaces for homes, offices, and commercial buildings.', required_subjects:'Art, Mathematics, Technical Drawing', education_level:'Bachelor\'s Degree', salary_range:'$35,000 - $80,000', skills_needed:'Design software, Creativity, Space planning, Communication', outlook:'Moderate Growth' },
    { title:'Marine Biologist', category:'Nature', description:'Study ocean life and marine ecosystems to understand and protect biodiversity.', required_subjects:'Biology, Chemistry, Geography, Mathematics', education_level:'Master\'s/Doctorate', salary_range:'$40,000 - $90,000', skills_needed:'Research, Diving, Data analysis, Field work', outlook:'Moderate Growth' },
    { title:'Entrepreneur', category:'Business', description:'Start and manage new business ventures, taking on financial risks for potential rewards.', required_subjects:'Business Studies, Economics, Mathematics, English', education_level:'Variable', salary_range:'$30,000 - $200,000+', skills_needed:'Leadership, Risk-taking, Networking, Innovation', outlook:'Variable' },
    { title:'Mechanic / Automotive Technician', category:'Engineering', description:'Diagnose and repair vehicle mechanical and electrical systems.', required_subjects:'Physics, Mathematics, Technical Drawing', education_level:'Certificate / Diploma', salary_range:'$30,000 - $70,000', skills_needed:'Diagnostic skills, Manual dexterity, Problem-solving, Technical knowledge', outlook:'Steady Growth' },
    { title:'Nutritionist / Dietitian', category:'Health', description:'Advise clients on healthy eating habits and design personalized nutrition plans.', required_subjects:'Biology, Chemistry, Home Economics', education_level:'Bachelor\'s Degree', salary_range:'$40,000 - $80,000', skills_needed:'Nutrition science, Communication, Planning, Empathy', outlook:'High Growth' },
    { title:'Film Director', category:'Arts', description:'Oversee creative aspects of film production, guiding actors and crew.', required_subjects:'Literature, Art, History, Computer Studies', education_level:'Film Degree / Experience', salary_range:'$40,000 - $200,000+', skills_needed:'Creativity, Leadership, Vision, Communication', outlook:'Variable' },
    { title:'Geologist', category:'Nature', description:'Study Earth\'s physical structure, composition, and processes.', required_subjects:'Geography, Chemistry, Physics, Mathematics', education_level:'Bachelor\'s/Master\'s Degree', salary_range:'$50,000 - $110,000', skills_needed:'Field work, Analysis, Mapping, Report writing', outlook:'Moderate Growth' },
    { title:'Network Engineer', category:'Technology', description:'Design, implement, and manage computer networks for organizations.', required_subjects:'Computer Science, Mathematics, Physics', education_level:'Bachelor\'s Degree', salary_range:'$55,000 - $115,000', skills_needed:'Networking protocols, Troubleshooting, Security, Linux', outlook:'High Growth' },
    { title:'Fashion Designer', category:'Arts', description:'Create original clothing, accessories, and footwear designs.', required_subjects:'Art, Home Economics, Business Studies', education_level:'Degree / Diploma', salary_range:'$30,000 - $100,000+', skills_needed:'Creativity, Sewing, Trend awareness, Business acumen', outlook:'Variable' },
    { title:'Anthropologist', category:'Social', description:'Study human societies, cultures, and development across time.', required_subjects:'History, Social Studies, Biology, Languages', education_level:'Master\'s/Doctorate', salary_range:'$45,000 - $90,000', skills_needed:'Research, Cultural sensitivity, Writing, Field work', outlook:'Moderate Growth' },
    { title:'Chemical Engineer', category:'Engineering', description:'Design and develop processes for producing chemicals, fuels, and products.', required_subjects:'Chemistry, Mathematics, Physics', education_level:'Bachelor\'s Degree', salary_range:'$65,000 - $130,000', skills_needed:'Chemistry, Process design, Safety knowledge, Problem-solving', outlook:'Moderate Growth' },
    { title:'Dentist', category:'Health', description:'Diagnose and treat dental issues, perform oral surgeries, and promote dental health.', required_subjects:'Biology, Chemistry, Physics, Mathematics', education_level:'Doctor of Dental Surgery (DDS)', salary_range:'$120,000 - $220,000', skills_needed:'Manual precision, Medical knowledge, Communication, Patience', outlook:'High Growth' },
    { title:'Forensic Scientist', category:'Science', description:'Collect and analyze physical evidence to help solve criminal investigations.', required_subjects:'Chemistry, Biology, Physics, Mathematics', education_level:'Bachelor\'s/Master\'s Degree', salary_range:'$45,000 - $95,000', skills_needed:'Lab techniques, Analysis, Attention to detail, Report writing', outlook:'High Growth' },
    { title:'Game Developer', category:'Technology', description:'Design and program video games for various platforms.', required_subjects:'Computer Science, Mathematics, Art', education_level:'Bachelor\'s Degree', salary_range:'$50,000 - $120,000', skills_needed:'Programming, Game engines, Creativity, Math', outlook:'High Growth' },
    { title:'Diplomat / Foreign Service Officer', category:'Social', description:'Represent government interests abroad and manage international relations.', required_subjects:'History, Political Science, Languages, Economics', education_level:'Bachelor\'s/Master\'s Degree', salary_range:'$50,000 - $130,000', skills_needed:'Negotiation, Languages, Cultural knowledge, Writing', outlook:'Steady Growth' },
    { title:'Botanist', category:'Nature', description:'Study plants, their physiology, ecology, and potential uses.', required_subjects:'Biology, Chemistry, Geography', education_level:'Master\'s/Doctorate', salary_range:'$40,000 - $85,000', skills_needed:'Research, Field studies, Lab work, Taxonomy', outlook:'Moderate Growth' },
    { title:'Human Resources Manager', category:'Business', description:'Oversee hiring, employee relations, training, and organizational development.', required_subjects:'Business Studies, Psychology, English', education_level:'Bachelor\'s Degree', salary_range:'$50,000 - $110,000', skills_needed:'Interpersonal skills, Organization, Labor law, Communication', outlook:'Steady Growth' },
    { title:'Pilot', category:'Engineering', description:'Operate aircraft to transport passengers and cargo safely.', required_subjects:'Physics, Mathematics, Geography, English', education_level:'Flight School + Licenses', salary_range:'$60,000 - $200,000', skills_needed:'Navigation, Decision-making, Technical knowledge, Communication', outlook:'Moderate Growth' },
    { title:'Clinical Psychologist', category:'Health', description:'Assess and treat mental health disorders through therapy and counseling.', required_subjects:'Psychology, Biology, English, Mathematics', education_level:'Doctorate (PhD/PsyD)', salary_range:'$60,000 - $130,000', skills_needed:'Therapy techniques, Assessment, Empathy, Research', outlook:'High Growth' },
    { title:'Photographer', category:'Arts', description:'Capture professional photos for events, portraits, commercial, or artistic purposes.', required_subjects:'Art, Computer Studies, English', education_level:'Degree / Self-taught', salary_range:'$25,000 - $80,000', skills_needed:'Camera techniques, Editing software, Creativity, Networking', outlook:'Variable' },
    { title:'Civil Rights Lawyer', category:'Social', description:'Advocate for individuals\' rights and fight against discrimination.', required_subjects:'History, Government, English, Social Studies', education_level:'Juris Doctor (JD)', salary_range:'$55,000 - $160,000', skills_needed:'Legal research, Advocacy, Writing, Public speaking', outlook:'Moderate Growth' },
    { title:'Astronomer', category:'Science', description:'Study celestial objects, space phenomena, and the universe.', required_subjects:'Physics, Mathematics, Computer Science', education_level:'Doctorate (PhD)', salary_range:'$60,000 - $140,000', skills_needed:'Mathematics, Research, Data analysis, Programming', outlook:'Moderate Growth' },
    { title:'Supply Chain Manager', category:'Business', description:'Oversee logistics, procurement, and distribution of goods.', required_subjects:'Mathematics, Economics, Business Studies', education_level:'Bachelor\'s/Master\'s Degree', salary_range:'$55,000 - $120,000', skills_needed:'Logistics, Negotiation, Analytics, Leadership', outlook:'High Growth' }
  ];

  const UNIVERSITY_SEED = [
    { university:'Massachusetts Institute of Technology', program:'Computer Science & Engineering', requirements:'Math A, Physics A, Chemistry B', location:'Cambridge, MA, USA', careers_match:'Software Engineer, Data Scientist, AI Researcher' },
    { university:'Stanford University', program:'Electrical Engineering', requirements:'Math A, Physics A, Chemistry A', location:'Stanford, CA, USA', careers_match:'Electrical Engineer, Aerospace Engineer, Network Engineer' },
    { university:'University of Oxford', program:'Medicine (MBBS)', requirements:'Biology A, Chemistry A, Math A', location:'Oxford, UK', careers_match:'Physician, Surgeon, Medical Researcher' },
    { university:'Harvard University', program:'Business Administration (MBA)', requirements:'Math B, Economics B, English B', location:'Cambridge, MA, USA', careers_match:'Entrepreneur, Financial Analyst, Marketing Manager' },
    { university:'ETH Zurich', program:'Mechanical Engineering', requirements:'Math A, Physics A, Chemistry B', location:'Zurich, Switzerland', careers_match:'Mechanical Engineer, Automotive Engineer, Aerospace Engineer' },
    { university:'University of Cambridge', program:'Natural Sciences', requirements:'Biology A, Chemistry A, Physics A, Math A', location:'Cambridge, UK', careers_match:'Environmental Scientist, Marine Biologist, Chemist' },
    { university:'California Institute of Technology', program:'Aerospace Engineering', requirements:'Math A, Physics A, Chemistry A', location:'Pasadena, CA, USA', careers_match:'Aerospace Engineer, Pilot, Astrophysicist' },
    { university:'Yale University', program:'Psychology', requirements:'Biology B, Math B, English B', location:'New Haven, CT, USA', careers_match:'Psychologist, Clinical Psychologist, Social Worker' },
    { university:'University of Toronto', program:'Nursing (BScN)', requirements:'Biology B, Chemistry B, English B', location:'Toronto, Canada', careers_match:'Registered Nurse, Nurse Practitioner, Public Health' },
    { university:'Imperial College London', program:'Biomedical Engineering', requirements:'Math A, Biology A, Physics A', location:'London, UK', careers_match:'Biomedical Engineer, Prosthetics Designer, Medical Device Developer' },
    { university:'Georgia Institute of Technology', program:'Industrial Design', requirements:'Math B, Physics B, Art A', location:'Atlanta, GA, USA', careers_match:'UX/UI Designer, Industrial Designer, Architect' },
    { university:'University of Edinburgh', program:'Veterinary Medicine', requirements:'Biology A, Chemistry A, Math B', location:'Edinburgh, UK', careers_match:'Veterinarian, Marine Biologist, Zoologist' },
    { university:'Princeton University', program:'Architecture', requirements:'Math A, Physics A, Art A', location:'Princeton, NJ, USA', careers_match:'Architect, Interior Designer, Urban Planner' },
    { university:'Columbia University', program:'Journalism', requirements:'English A, History B, Social Studies B', location:'New York, NY, USA', careers_match:'Journalist, Diplomat, Political Analyst' },
    { university:'University of Melbourne', program:'Environmental Science', requirements:'Biology B, Chemistry B, Geography B', location:'Melbourne, Australia', careers_match:'Environmental Scientist, Conservationist, Geologist' },
    { university:'Technical University of Munich', program:'Chemical Engineering', requirements:'Chemistry A, Math A, Physics A', location:'Munich, Germany', careers_match:'Chemical Engineer, Pharmacist, Forensic Scientist' },
    { university:'University of Cape Town', program:'Law (LLB)', requirements:'English A, History B, Social Studies B', location:'Cape Town, South Africa', careers_match:'Lawyer, Civil Rights Lawyer, Diplomat' },
    { university:'National University of Singapore', program:'Data Science & Analytics', requirements:'Math A, Computer Science A, Statistics B', location:'Singapore', careers_match:'Data Scientist, Cybersecurity Analyst, Game Developer' },
    { university:'Seoul National University', program:'Food Science & Nutrition', requirements:'Biology B, Chemistry B, Math B', location:'Seoul, South Korea', careers_match:'Nutritionist, Food Scientist, Agricultural Scientist' },
    { university:'University of São Paulo', program:'Agricultural Engineering', requirements:'Math B, Biology B, Chemistry B, Physics B', location:'São Paulo, Brazil', careers_match:'Agricultural Scientist, Botanist, Environmental Engineer' }
  ];

  // ─── SVG Radar Chart Helper ──────────────────────────────────────
  function radarSVG(scores, labels, size, id) {
    size = size || 300;
    id = id || 'radar';
    const cx = size / 2, cy = size / 2, r = size * 0.38;
    const n = labels.length;
    if (n < 3) return '<p style="color:'+CTEXTM+'">Need at least 3 categories for chart</p>';
    const angles = labels.map((_, i) => (Math.PI * 2 * i / n) - Math.PI / 2);

    function pt(angle, frac) {
      return { x: cx + Math.cos(angle) * r * frac, y: cy + Math.sin(angle) * r * frac };
    }

    let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Radar chart showing ${n} aptitude dimensions">`;

    // Grid rings
    [0.2, 0.4, 0.6, 0.8, 1.0].forEach(f => {
      const pts = angles.map(a => { const p = pt(a, f); return `${p.x},${p.y}`; }).join(' ');
      svg += `<polygon points="${pts}" fill="none" stroke="#e5e7eb" stroke-width="1"/>`;
    });

    // Axis lines
    angles.forEach(a => {
      const p = pt(a, 1);
      svg += `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="#e5e7eb" stroke-width="1"/>`;
    });

    // Data polygon
    const maxVal = Math.max(...scores, 1);
    const dataPts = angles.map((a, i) => {
      const frac = Math.max(0, Math.min(1, scores[i] / maxVal));
      const p = pt(a, frac);
      return `${p.x},${p.y}`;
    }).join(' ');
    svg += `<polygon points="${dataPts}" fill="${CBG}" stroke="${C}" stroke-width="2.5" opacity="0.85"/>`;

    // Data dots + labels
    angles.forEach((a, i) => {
      const frac = Math.max(0, Math.min(1, scores[i] / maxVal));
      const p = pt(a, frac);
      const lp = pt(a, 1.22);
      svg += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${C}"/>`;
      svg += `<text x="${lp.x}" y="${lp.y}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="${CTEXTC}" font-family="system-ui,sans-serif">${esc(labels[i])}</text>`;
      svg += `<text x="${lp.x}" y="${lp.y + 13}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="${CTEXTM}" font-family="system-ui,sans-serif">${scores[i]}%</text>`;
    });

    svg += '</svg>';
    return svg;
  }

  // ─── Score Bar Helper ────────────────────────────────────────────
  function scoreBar(pct, label) {
    const col = pct >= 75 ? CSUCCESS : pct >= 50 ? CWARN : CDANGER;
    return `<div style="margin:6px 0">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
        <span style="color:${CTEXTC}">${esc(label)}</span>
        <span style="color:${col};font-weight:600">${pct}%</span>
      </div>
      <div style="background:#e5e7eb;border-radius:6px;height:10px;overflow:hidden">
        <div style="background:${col};height:100%;width:${pct}%;border-radius:6px;transition:width 0.5s"></div>
      </div>
    </div>`;
  }

  // ─── Nav Helper ──────────────────────────────────────────────────
  function careerNav(active) {
    const links = [
      { href:'/career-guidance', label:'Dashboard', key:'dash' },
      { href:'/career-guidance/aptitude', label:'Aptitude Test', key:'apt' },
      { href:'/career-guidance/interests', label:'Interest Inventory', key:'int' },
      { href:'/career-guidance/careers', label:'Career Library', key:'lib' },
      { href:'/career-guidance/universities', label:'Universities', key:'uni' },
      { href:'/career-guidance/profile', label:'My Profile', key:'prof' },
      { href:'/career-guidance/counselling', label:'Counselling', key:'coun' }
    ];
    return `<nav style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px" aria-label="Career Guidance Navigation">
      ${links.map(l => `<a href="${l.href}" style="padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;${active===l.key?'background:'+C+';color:#fff':'color:'+CTEXTM+';background:'+CBG2}">${l.label}</a>`).join('')}
    </nav>`;
  }

  // ─── Initialize Tables & Seed ────────────────────────────────────
  (async () => {
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${prefix}aptitude_tests (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${tid}',
        student_id INTEGER NOT NULL,
        section TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 5,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        time_spent_seconds INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS ${prefix}aptitude_answers (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${tid}',
        test_id INTEGER REFERENCES ${prefix}aptitude_tests(id),
        question_index INTEGER NOT NULL,
        selected_option INTEGER NOT NULL,
        is_correct BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE TABLE IF NOT EXISTS ${prefix}interest_responses (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${tid}',
        student_id INTEGER NOT NULL,
        interest_id TEXT NOT NULL,
        responded_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, student_id, interest_id)
      );
      CREATE TABLE IF NOT EXISTS ${prefix}career_library (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${tid}',
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        required_subjects TEXT NOT NULL,
        education_level TEXT NOT NULL,
        salary_range TEXT NOT NULL,
        skills_needed TEXT NOT NULL,
        outlook TEXT NOT NULL,
        aptitude_keys TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS ${prefix}career_recommendations (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${tid}',
        student_id INTEGER NOT NULL,
        career_library_id INTEGER REFERENCES ${prefix}career_library(id),
        match_percent INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'aptitude',
        calculated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ${prefix}university_programs (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${tid}',
        university TEXT NOT NULL,
        program TEXT NOT NULL,
        requirements TEXT NOT NULL,
        location TEXT NOT NULL,
        careers_match TEXT NOT NULL DEFAULT '',
        recommended_subjects TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS ${prefix}career_counselling_sessions (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${tid}',
        student_id INTEGER NOT NULL,
        counsellor_id INTEGER NOT NULL,
        session_date DATE NOT NULL DEFAULT CURRENT_DATE,
        topic TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        action_items TEXT NOT NULL DEFAULT '',
        follow_up_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Seed career library
    const catAptMap = {
      Technology: 'logical,numerical,creative',
      Health: 'verbal,logical,creative',
      Engineering: 'numerical,spatial,mechanical',
      Arts: 'creative,spatial,verbal',
      Business: 'numerical,verbal,logical',
      Social: 'verbal,logical,creative',
      Nature: 'logical,spatial,verbal',
      Science: 'logical,numerical,verbal'
    };

    const seeded = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${prefix}career_library WHERE tenant_id=$1`, [tid]);
    if (seeded.rows[0].cnt === 0) {
      for (const c of CAREER_SEED) {
        const ak = catAptMap[c.category] || 'logical,verbal';
        await pool.query(
          `INSERT INTO ${prefix}career_library (tenant_id,title,category,description,required_subjects,education_level,salary_range,skills_needed,outlook,aptitude_keys) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [tid, c.title, c.category, c.description, c.required_subjects, c.education_level, c.salary_range, c.skills_needed, c.outlook, ak]
        );
      }
    }

    // Seed university programs
    const uSeeded = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${prefix}university_programs WHERE tenant_id=$1`, [tid]);
    if (uSeeded.rows[0].cnt === 0) {
      for (const u of UNIVERSITY_SEED) {
        await pool.query(
          `INSERT INTO ${prefix}university_programs (tenant_id,university,program,requirements,location,careers_match,recommended_subjects) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tid, u.university, u.program, u.requirements, u.location, u.careers_match, u.requirements]
        );
      }
    }

    console.log('[career-guidance] Tables and seed data ready.');
  })();

  // ─── Routes ──────────────────────────────────────────────────────

  // Dashboard
  app.get('/career-guidance', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';

    const [testRes, intRes, recRes, sessRes] = await Promise.all([
      pool.query(`SELECT section, score, total FROM ${prefix}aptitude_tests WHERE tenant_id=$1 AND student_id=$2 AND completed_at IS NOT NULL ORDER BY section`, [tid, uid]),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM ${prefix}interest_responses WHERE tenant_id=$1 AND student_id=$2`, [tid, uid]),
      pool.query(`SELECT cl.title, cr.match_percent, cr.source FROM ${prefix}career_recommendations cr JOIN ${prefix}career_library cl ON cl.id=cr.career_library_id WHERE cr.tenant_id=$1 AND cr.student_id=$2 ORDER BY cr.match_percent DESC LIMIT 5`, [tid, uid]),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM ${prefix}career_counselling_sessions WHERE tenant_id=$1 AND student_id=$2`, [tid, uid])
    ]);

    const scores = {};
    SECTIONS.forEach(s => { scores[s.key] = { score: 0, total: 5 }; });
    testRes.rows.forEach(r => { if (scores[r.section]) scores[r.section] = { score: r.score, total: r.total }; });

    const completedSections = testRes.rows.length;
    const completedInterests = intRes.rows[0].cnt;
    const totalInterests = INTERESTS.length;

    let radarHtml = '';
    if (completedSections > 0) {
      const vals = SECTIONS.map(s => scores[s.key].total > 0 ? Math.round(scores[s.key].score / scores[s.key].total * 100) : 0);
      radarHtml = radarSVG(vals, SECTIONS.map(s => s.label.replace(' Reasoning','').replace(' Ability','').replace(' Aptitude','').replace(' Comprehension','').replace(' Thinking','')), 320, 'dash-radar');
    }

    const html = `
      ${careerNav('dash')}
      <div style="max-width:1000px">
        <h1 style="font-size:28px;font-weight:700;color:${CTEXTC};margin-bottom:24px">🎯 Career Guidance Center</h1>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:32px">
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:32px;font-weight:700;color:${C}">${completedSections}/6</div>
            <div style="color:${CTEXTM};font-size:13px;margin-top:4px">Aptitude Sections</div>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:32px;font-weight:700;color:${completedInterests>=30?CSUCCESS:CWARN}">${completedInterests}/${totalInterests}</div>
            <div style="color:${CTEXTM};font-size:13px;margin-top:4px">Interests Selected</div>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:32px;font-weight:700;color:${C}">${recRes.rows.length}</div>
            <div style="color:${CTEXTM};font-size:13px;margin-top:4px">Career Matches</div>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:32px;font-weight:700;color:${sessRes.rows[0].cnt>0?CSUCCESS:CTEXTM}">${sessRes.rows[0].cnt}</div>
            <div style="color:${CTEXTM};font-size:13px;margin-top:4px">Counselling Sessions</div>
          </div>
        </div>

        ${radarHtml ? `<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;margin-bottom:32px">
          <div style="flex:0 0 320px">${radarHtml}</div>
          <div style="flex:1;min-width:250px">
            <h2 style="font-size:18px;font-weight:600;color:${CTEXTC};margin-bottom:12px">Top Career Matches</h2>
            ${recRes.rows.length === 0 ? '<p style="color:'+CTEXTM+'">Complete your aptitude test and interest inventory to see matches.</p>' : recRes.rows.map(r => scoreBar(r.match_percent, esc(r.title) + ' <span style="font-size:11px;color:'+CTEXTM+'">(' + esc(r.source) + ')</span>')).join('')}
          </div>
        </div>` : ''}

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
          <a href="/career-guidance/aptitude" style="background:${C};color:#fff;border-radius:12px;padding:20px;text-decoration:none;display:block">
            <div style="font-size:18px;font-weight:600;margin-bottom:4px">🧩 Start Aptitude Test</div>
            <div style="font-size:13px;opacity:0.85">30 questions across 6 skill areas</div>
          </a>
          <a href="/career-guidance/interests" style="background:#fff;color:${CTEXTC};border:2px solid ${C};border-radius:12px;padding:20px;text-decoration:none;display:block">
            <div style="font-size:18px;font-weight:600;margin-bottom:4px">❤️ Interest Inventory</div>
            <div style="font-size:13px;color:${CTEXTM}">Select activities that interest you</div>
          </a>
          <a href="/career-guidance/careers" style="background:#fff;color:${CTEXTC};border:2px solid #e5e7eb;border-radius:12px;padding:20px;text-decoration:none;display:block">
            <div style="font-size:18px;font-weight:600;margin-bottom:4px">📚 Explore Careers</div>
            <div style="font-size:13px;color:${CTEXTM}">Browse 50+ career options</div>
          </a>
        </div>
      </div>`;
    res.send(renderPage('Career Guidance', html, req.session.user));
  }));

  // Aptitude Test — Start / Continue
  app.get('/career-guidance/aptitude', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';

    const completed = await pool.query(
      `SELECT section FROM ${prefix}aptitude_tests WHERE tenant_id=$1 AND student_id=$2 AND completed_at IS NOT NULL`,
      [tid, uid]
    );
    const doneSections = new Set(completed.rows.map(r => r.section));

    if (doneSections.size === 6) {
      return res.redirect('/career-guidance/aptitude/results');
    }

    const nextSection = SECTIONS.find(s => !doneSections.has(s.key));
    if (!nextSection) return res.redirect('/career-guidance/aptitude/results');

    const sectionIdx = SECTIONS.indexOf(nextSection);
    const sectionQuestions = APTITUDE_QUESTIONS.filter(q => q.section === nextSection.key);

    const html = `
      ${careerNav('apt')}
      <div style="max-width:800px">
        <h1 style="font-size:24px;font-weight:700;color:${CTEXTC};margin-bottom:8px">${nextSection.icon} ${esc(nextSection.label)}</h1>
        <p style="color:${CTEXTM};margin-bottom:20px">Section ${sectionIdx+1} of 6 — ${sectionQuestions.length} questions — ${Math.floor(nextSection.timeLimit/60)} minute timer</p>

        <div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap">
          ${SECTIONS.map((s, i) => {
            const done = doneSections.has(s.key);
            const current = s.key === nextSection.key;
            return `<span style="padding:6px 12px;border-radius:6px;font-size:12px;font-weight:500;${done?'background:'+CSUCCESS+';color:#fff':current?'background:'+C+';color:#fff':'background:'+CBG2+';color:'+CTEXTM}">${s.icon} ${s.label.replace(' Reasoning','').replace(' Ability','').replace(' Aptitude','').replace(' Comprehension','').replace(' Thinking','')}</span>`;
          }).join('')}
        </div>

        <form method="POST" action="/career-guidance/aptitude/submit" id="aptForm" role="form" aria-label="${esc(nextSection.label)} questions">
          <input type="hidden" name="section" value="${esc(nextSection.key)}" />
          <input type="hidden" name="timeLimit" value="${nextSection.timeLimit}" />

          ${sectionQuestions.map((q, qi) => `
            <fieldset style="border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;margin-bottom:16px;background:#fff">
              <legend style="font-weight:600;color:${CTEXTC};font-size:14px;padding:0 8px">Question ${qi+1}</legend>
              <p style="margin:8px 0 12px;color:${CTEXTC};font-size:15px">${esc(q.q)}</p>
              ${q.opts.map((o, oi) => `
                <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin:4px 0;border-radius:6px;cursor:pointer;transition:background 0.15s" onmouseover="this.style.background='${CBG}'" onmouseout="this.style.background='transparent'">
                  <input type="radio" name="q${qi}" value="${oi}" required aria-label="${esc(o)}" style="accent-color:${C}" />
                  <span style="font-size:14px;color:${CTEXTC}">${esc(o)}</span>
                </label>
              `).join('')}
            </fieldset>
          `).join('')}

          <div style="display:flex;align-items:center;gap:16px;margin-top:24px">
            <button type="submit" style="background:${C};color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer" aria-label="Submit answers">
              Submit Section
            </button>
            <span id="timerDisplay" style="font-size:18px;font-weight:600;color:${C};font-variant-numeric:tabular-nums" aria-live="polite" role="timer">05:00</span>
          </div>
        </form>
      </div>

      <script>
        (function(){
          var limit = parseInt(document.querySelector('input[name=timeLimit]').value);
          var remaining = limit;
          var display = document.getElementById('timerDisplay');
          var interval = setInterval(function(){
            remaining--;
            if(remaining <= 0){ clearInterval(interval); document.getElementById('aptForm').submit(); }
            var m = Math.floor(remaining/60); var s = remaining%60;
            display.textContent = (m<10?'0':'')+m+':'+(s<10?'0':'')+s;
            if(remaining < 60) display.style.color = '#dc2626';
          }, 1000);
        })();
      </script>`;
    res.send(renderPage('Aptitude Test — ' + nextSection.label, html, req.session.user));
  }));

  // Aptitude Test — Submit
  app.post('/career-guidance/aptitude/submit', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';
    const section = req.body.section;
    const timeLimit = parseInt(req.body.timeLimit) || 300;
    const timeSpent = timeLimit - Math.max(0, (req.body._timerRemaining ? parseInt(req.body._timerRemaining) : 0));

    const sectionQuestions = APTITUDE_QUESTIONS.filter(q => q.section === section);
    let correct = 0;

    const testRes = await pool.query(
      `INSERT INTO ${prefix}aptitude_tests (tenant_id,student_id,section,score,total,time_spent_seconds,completed_at) VALUES ($1,$2,$3,0,$4,$5,NOW()) RETURNING id`,
      [tid, uid, section, sectionQuestions.length, timeSpent]
    );
    const testId = testRes.rows[0].id;

    for (let i = 0; i < sectionQuestions.length; i++) {
      const sel = req.body['q' + i] !== undefined ? parseInt(req.body['q' + i]) : -1;
      const isCorrect = sel === sectionQuestions[i].correct;
      if (isCorrect) correct++;

      await pool.query(
        `INSERT INTO ${prefix}aptitude_answers (tenant_id,test_id,question_index,selected_option,is_correct) VALUES ($1,$2,$3,$4,$5)`,
        [tid, testId, i, sel, isCorrect]
      );
    }

    await pool.query(
      `UPDATE ${prefix}aptitude_tests SET score=$1 WHERE id=$2 AND tenant_id=$3`,
      [correct, testId, tid]
    );

    // Calculate recommendations
    await calculateRecommendations(uid, tid, prefix);

    audit('aptitude_submit', { student_id: uid, section, score: correct, total: sectionQuestions.length });
    res.redirect('/career-guidance/aptitude/results');
  }));

  // Aptitude Results
  app.get('/career-guidance/aptitude/results', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';

    const results = await pool.query(
      `SELECT section, score, total, time_spent_seconds FROM ${prefix}aptitude_tests WHERE tenant_id=$1 AND student_id=$2 AND completed_at IS NOT NULL ORDER BY section`,
      [tid, uid]
    );

    if (results.rows.length === 0) {
      return res.redirect('/career-guidance/aptitude');
    }

    const labels = results.rows.map(r => SECTIONS.find(s => s.key === r.section)?.label?.replace(' Reasoning','').replace(' Ability','').replace(' Aptitude','').replace(' Comprehension','').replace(' Thinking','') || r.section);
    const vals = results.rows.map(r => r.total > 0 ? Math.round(r.score / r.total * 100) : 0);
    const overallPct = vals.length > 0 ? Math.round(vals.reduce((a,b) => a+b, 0) / vals.length) : 0;

    const recs = await pool.query(
      `SELECT cl.title, cr.match_percent FROM ${prefix}career_recommendations cr JOIN ${prefix}career_library cl ON cl.id=cr.career_library_id WHERE cr.tenant_id=$1 AND cr.student_id=$2 AND cr.source='aptitude' ORDER BY cr.match_percent DESC LIMIT 10`,
      [tid, uid]
    );

    const html = `
      ${careerNav('apt')}
      <div style="max-width:900px">
        <h1 style="font-size:24px;font-weight:700;color:${CTEXTC};margin-bottom:8px">📊 Aptitude Test Results</h1>
        <p style="color:${CTEXTM};margin-bottom:24px">Sections completed: ${results.rows.length}/6 — Overall: ${overallPct}%</p>

        <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;margin-bottom:32px">
          <div style="flex:0 0 320px;background:#fff;border-radius:12px;padding:20px;border:1px solid #e5e7eb">
            <h2 style="font-size:16px;font-weight:600;color:${CTEXTC};margin-bottom:12px;text-align:center">Aptitude Profile</h2>
            ${radarSVG(vals, labels, 300, 'results-radar')}
          </div>
          <div style="flex:1;min-width:280px">
            <h2 style="font-size:16px;font-weight:600;color:${CTEXTC};margin-bottom:12px">Section Scores</h2>
            ${results.rows.map(r => {
              const sec = SECTIONS.find(s => s.key === r.section);
              const pct = r.total > 0 ? Math.round(r.score / r.total * 100) : 0;
              return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f3f4f6">
                <span style="color:${CTEXTC}">${sec ? sec.icon : ''} ${esc(sec?.label || r.section)}</span>
                <span style="font-weight:600;color:${pct>=75?CSUCCESS:pct>=50?CWARN:CDANGER}">${r.score}/${r.total} (${pct}%)</span>
              </div>`;
            }).join('')}
          </div>
        </div>

        ${recs.rows.length > 0 ? `
          <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;margin-bottom:24px">
            <h2 style="font-size:18px;font-weight:600;color:${CTEXTC};margin-bottom:16px">🏆 Top Career Matches</h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px">
              ${recs.rows.map(r => `
                <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px">
                  <div style="font-weight:600;color:${CTEXTC}">${esc(r.title)}</div>
                  ${scoreBar(r.match_percent, 'Match')}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div style="display:flex;gap:12px">
          ${results.rows.length < 6 ? `<a href="/career-guidance/aptitude" style="display:inline-block;background:${C};color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500">Continue Test</a>` : ''}
          <a href="/career-guidance/profile" style="display:inline-block;background:#fff;color:${C};border:2px solid ${C};padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500">View Full Profile</a>
        </div>
      </div>`;
    res.send(renderPage('Aptitude Results', html, req.session.user));
  }));

  // Interest Inventory
  app.get('/career-guidance/interests', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';

    const existing = await pool.query(
      `SELECT interest_id FROM ${prefix}interest_responses WHERE tenant_id=$1 AND student_id=$2`,
      [tid, uid]
    );
    const selected = new Set(existing.rows.map(r => r.interest_id));

    const categories = [...new Set(INTERESTS.map(i => i.category))];

    const html = `
      ${careerNav('int')}
      <div style="max-width:800px">
        <h1 style="font-size:24px;font-weight:700;color:${CTEXTC};margin-bottom:8px">❤️ Interest Inventory</h1>
        <p style="color:${CTEXTM};margin-bottom:24px">Select all activities that interest you. We'll match your interests to potential careers. (${INTERESTS.length} items)</p>

        <form method="POST" action="/career-guidance/interests/submit" role="form" aria-label="Interest inventory form">
          ${categories.map(cat => `
            <div style="margin-bottom:24px">
              <h2 style="font-size:17px;font-weight:600;color:${CTEXTC};margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid ${C}">${esc(cat)}</h2>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px">
                ${INTERESTS.filter(i => i.category === cat).map(int => `
                  <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;transition:all 0.15s;background:${selected.has(int.id)?CBG:'#fff'}" onmouseover="this.style.borderColor='${C}'" onmouseout="this.style.borderColor='${selected.has(int.id)?CL:'#e5e7eb'}'">
                    <input type="checkbox" name="interests" value="${esc(int.id)}" ${selected.has(int.id)?'checked':''} style="accent-color:${C};width:18px;height:18px" aria-label="${esc(int.label)}" />
                    <span style="font-size:14px;color:${CTEXTC}">${esc(int.label)}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          `).join('')}

          <button type="submit" style="background:${C};color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin-top:8px">
            Save Interests &amp; Find Matches
          </button>
        </form>
      </div>`;
    res.send(renderPage('Interest Inventory', html, req.session.user));
  }));

  // Interest Submit
  app.post('/career-guidance/interests/submit', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';
    const interests = Array.isArray(req.body.interests) ? req.body.interests : (req.body.interests ? [req.body.interests] : []);

    // Clear old
    await pool.query(`DELETE FROM ${prefix}interest_responses WHERE tenant_id=$1 AND student_id=$2`, [tid, uid]);

    // Insert new
    for (const iid of interests) {
      await pool.query(
        `INSERT INTO ${prefix}interest_responses (tenant_id,student_id,interest_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [tid, uid, iid]
      );
    }

    await calculateInterestMatches(uid, tid, prefix);
    audit('interest_submit', { student_id: uid, count: interests.length });
    req.session.flash = { type: 'success', msg: `${interests.length} interests saved! Career matches updated.` };
    res.redirect('/career-guidance/interests');
  }));

  // Career Library
  app.get('/career-guidance/careers', requireAuth, ah(async (req, res) => {
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';
    const search = (req.query.search || '').trim();
    const catFilter = req.query.category || '';

    let sql = `SELECT * FROM ${prefix}career_library WHERE tenant_id=$1`;
    const params = [tid];

    if (search) {
      sql += ` AND (title ILIKE $2 OR description ILIKE $2 OR skills_needed ILIKE $2)`;
      params.push(`%${search}%`);
    }
    if (catFilter) {
      sql += ` AND category=$${params.length + 1}`;
      params.push(catFilter);
    }
    sql += ` ORDER BY title LIMIT 60`;

    const careers = await pool.query(sql, params);
    const cats = await pool.query(`SELECT DISTINCT category FROM ${prefix}career_library WHERE tenant_id=$1 ORDER BY category`, [tid]);

    const html = `
      ${careerNav('lib')}
      <div style="max-width:1000px">
        <h1 style="font-size:24px;font-weight:700;color:${CTEXTC};margin-bottom:20px">📚 Career Library</h1>

        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
          <form method="GET" action="/career-guidance/careers" style="flex:1;min-width:200px" role="search">
            <input type="text" name="search" value="${esc(search)}" placeholder="Search careers..." aria-label="Search careers"
              style="width:100%;padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box" />
          </form>
          <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
            <span style="font-size:13px;color:${CTEXTM};margin-right:4px">Filter:</span>
            <a href="/career-guidance/careers" style="padding:6px 12px;border-radius:6px;font-size:12px;text-decoration:none;${!catFilter?'background:'+C+';color:#fff':'color:'+CTEXTM+';background:'+CBG2}">All</a>
            ${cats.rows.map(c => `<a href="/career-guidance/careers?category=${encodeURIComponent(c.category)}${search?'&search='+encodeURIComponent(search):''}" style="padding:6px 12px;border-radius:6px;font-size:12px;text-decoration:none;${catFilter===c.category?'background:'+C+';color:#fff':'color:'+CTEXTM+';background:'+CBG2}">${esc(c.category)}</a>`).join('')}
          </div>
        </div>

        <p style="color:${CTEXTM};font-size:13px;margin-bottom:16px">${careers.rows.length} careers found</p>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
          ${careers.rows.map(c => `
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;transition:box-shadow 0.15s" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'" onmouseout="this.style.boxShadow='none'">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
                <h3 style="font-size:16px;font-weight:600;color:${CTEXTC};margin:0">${esc(c.title)}</h3>
                <span style="background:${CBG};color:${C};font-size:11px;padding:2px 8px;border-radius:10px;white-space:nowrap">${esc(c.category)}</span>
              </div>
              <p style="font-size:13px;color:${CTEXTM};margin-bottom:10px;line-height:1.5">${esc(c.description)}</p>
              <div style="font-size:12px;color:${CTEXTM};display:flex;flex-direction:column;gap:4px">
                <div><strong style="color:${CTEXTC}">Education:</strong> ${esc(c.education_level)}</div>
                <div><strong style="color:${CTEXTC}">Salary:</strong> ${esc(c.salary_range)}</div>
                <div><strong style="color:${CTEXTC}">Subjects:</strong> ${esc(c.required_subjects)}</div>
                <div><strong style="color:${CTEXTC}">Outlook:</strong> <span style="color:${c.outlook.includes('Very High')?CSUCCESS:c.outlook.includes('High')?C:c.outlook.includes('Moderate')?CWARN:CTEXTM}">${esc(c.outlook)}</span></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
    res.send(renderPage('Career Library', html, req.session.user));
  }));

  // University Recommendations
  app.get('/career-guidance/universities', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';
    const search = (req.query.search || '').trim();

    let sql = `SELECT * FROM ${prefix}university_programs WHERE tenant_id=$1`;
    const params = [tid];
    if (search) {
      sql += ` AND (university ILIKE $2 OR program ILIKE $2 OR location ILIKE $2 OR careers_match ILIKE $2)`;
      params.push(`%${search}%`);
    }
    sql += ` ORDER BY university, program`;
    const programs = await pool.query(sql, params);

    // Get student top careers for matching
    const topCareers = await pool.query(
      `SELECT cl.title FROM ${prefix}career_recommendations cr JOIN ${prefix}career_library cl ON cl.id=cr.career_library_id WHERE cr.tenant_id=$1 AND cr.student_id=$2 ORDER BY cr.match_percent DESC LIMIT 5`,
      [tid, uid]
    );

    const topCareerSet = new Set(topCareers.rows.map(r => r.title.toLowerCase()));

    const html = `
      ${careerNav('uni')}
      <div style="max-width:1000px">
        <h1 style="font-size:24px;font-weight:700;color:${CTEXTC};margin-bottom:8px">🎓 University Programs</h1>
        <p style="color:${CTEXTM};margin-bottom:20px">Explore programs at leading universities. Top matches highlighted based on your career profile.</p>

        <form method="GET" style="margin-bottom:20px" role="search">
          <input type="text" name="search" value="${esc(search)}" placeholder="Search universities, programs, locations..." aria-label="Search university programs"
            style="width:100%;max-width:500px;padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box" />
        </form>

        ${topCareers.rows.length > 0 ? `<div style="background:${CBG};border:1px solid ${CL};border-radius:10px;padding:14px 18px;margin-bottom:20px">
          <span style="font-size:13px;color:${CTEXTC};font-weight:600">Your top career interests: </span>
          ${topCareers.rows.map(r => `<span style="background:#fff;padding:3px 10px;border-radius:12px;font-size:12px;color:${C};margin-right:6px;display:inline-block;margin-bottom:4px">${esc(r.title)}</span>`).join('')}
        </div>` : ''}

        <div style="display:grid;gap:12px">
          ${programs.rows.map(p => {
            let relevanceScore = 0;
            const careers = p.careers_match.split(',').map(c => c.trim().toLowerCase());
            careers.forEach(c => { if (topCareerSet.has(c)) relevanceScore += 33; });
            const isMatch = relevanceScore > 0;

            return `<div style="background:${isMatch?'#f0fdf4':'#fff'};border:${isMatch?'2px solid #86efac':'1px solid #e5e7eb'};border-radius:12px;padding:18px;transition:box-shadow 0.15s" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'" onmouseout="this.style.boxShadow='none'">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:8px">
                <div>
                  <h3 style="font-size:16px;font-weight:600;color:${CTEXTC};margin:0">${esc(p.university)}</h3>
                  <p style="font-size:14px;color:${C};font-weight:500;margin:2px 0 0">${esc(p.program)}</p>
                </div>
                <div style="text-align:right">
                  ${isMatch ? '<span style="background:#dcfce7;color:#166534;font-size:11px;padding:3px 10px;border-radius:10px;font-weight:600">⭐ Recommended for you</span>' : ''}
                  <div style="font-size:12px;color:${CTEXTM};margin-top:4px">📍 ${esc(p.location)}</div>
                </div>
              </div>
              <div style="font-size:13px;color:${CTEXTM};display:flex;flex-wrap:wrap;gap:16px">
                <div><strong style="color:${CTEXTC}">Requirements:</strong> ${esc(p.requirements)}</div>
                <div><strong style="color:${CTEXTC}">Careers:</strong> ${esc(p.careers_match)}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    res.send(renderPage('University Programs', html, req.session.user));
  }));

  // Student Career Profile
  app.get('/career-guidance/profile', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';

    const [testRes, intRes, recRes] = await Promise.all([
      pool.query(`SELECT section, score, total FROM ${prefix}aptitude_tests WHERE tenant_id=$1 AND student_id=$2 AND completed_at IS NOT NULL ORDER BY section`, [tid, uid]),
      pool.query(`SELECT ir.interest_id, i.label, i.category FROM ${prefix}interest_responses ir JOIN (${INTERESTS.map(x => `SELECT '${x.id}' AS id, '${x.label.replace(/'/g,"''")}' AS label, '${x.category}' AS category`).join(' UNION ALL ')}) i ON i.id=ir.interest_id WHERE ir.tenant_id=$1 AND ir.student_id=$2 ORDER BY i.category, i.label`, [tid, uid]),
      pool.query(`SELECT cl.title, cl.category, cl.description, cl.required_subjects, cl.education_level, cl.salary_range, cr.match_percent, cr.source FROM ${prefix}career_recommendations cr JOIN ${prefix}career_library cl ON cl.id=cr.career_library_id WHERE cr.tenant_id=$1 AND cr.student_id=$2 ORDER BY cr.match_percent DESC LIMIT 5`, [tid, uid])
    ]);

    // Build aptitude profile
    const aptData = {};
    SECTIONS.forEach(s => { aptData[s.key] = { score: 0, total: 5 }; });
    testRes.rows.forEach(r => { if (aptData[r.section]) aptData[r.section] = { score: r.score, total: r.total }; });

    const labels = SECTIONS.map(s => s.label.replace(' Reasoning','').replace(' Ability','').replace(' Aptitude','').replace(' Comprehension','').replace(' Thinking',''));
    const vals = SECTIONS.map(s => aptData[s.key].total > 0 ? Math.round(aptData[s.key].score / aptData[s.key].total * 100) : 0);

    const interestCats = {};
    intRes.rows.forEach(r => {
      if (!interestCats[r.category]) interestCats[r.category] = [];
      interestCats[r.category].push(r.label);
    });

    // Strengths
    const strengths = [];
    const weaknesses = [];
    vals.forEach((v, i) => {
      if (v >= 70) strengths.push(SECTIONS[i].label);
      if (v < 40 && testRes.rows.length > 0) weaknesses.push(SECTIONS[i].label);
    });

    const html = `
      ${careerNav('prof')}
      <div style="max-width:1000px">
        <h1 style="font-size:24px;font-weight:700;color:${CTEXTC};margin-bottom:24px">👤 My Career Profile</h1>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px;flex-wrap:wrap">
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px">
            <h2 style="font-size:17px;font-weight:600;color:${CTEXTC};margin-bottom:16px">Aptitude Profile</h2>
            <div style="text-align:center">${radarSVG(vals, labels, 300, 'profile-radar')}</div>
            ${strengths.length > 0 ? `<div style="margin-top:12px"><span style="font-size:12px;color:${CSUCCESS};font-weight:600">✅ Strengths:</span> <span style="font-size:12px;color:${CTEXTM}">${strengths.map(s => esc(s)).join(', ')}</span></div>` : ''}
            ${weaknesses.length > 0 ? `<div style="margin-top:4px"><span style="font-size:12px;color:${CDANGER};font-weight:600">⚠️ Areas to develop:</span> <span style="font-size:12px;color:${CTEXTM}">${weaknesses.map(s => esc(s)).join(', ')}</span></div>` : ''}
          </div>

          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px">
            <h2 style="font-size:17px;font-weight:600;color:${CTEXTC};margin-bottom:12px">Interest Profile</h2>
            ${Object.keys(interestCats).length === 0 ? '<p style="color:'+CTEXTM+'">No interests selected yet. <a href="/career-guidance/interests" style="color:'+C+'">Complete the interest inventory</a>.</p>' :
              Object.entries(interestCats).map(([cat, items]) => `
                <div style="margin-bottom:10px">
                  <div style="font-size:13px;font-weight:600;color:${CTEXTC};margin-bottom:4px">${esc(cat)} (${items.length})</div>
                  <div style="display:flex;flex-wrap:wrap;gap:4px">
                    ${items.map(item => `<span style="background:${CBG};color:${C};font-size:11px;padding:2px 8px;border-radius:10px">${esc(item)}</span>`).join('')}
                  </div>
                </div>
              `).join('')}
          </div>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px">
          <h2 style="font-size:18px;font-weight:600;color:${CTEXTC};margin-bottom:16px">🏆 Top 5 Career Matches</h2>
          ${recRes.rows.length === 0 ? '<p style="color:'+CTEXTM+'">Complete the aptitude test and/or interest inventory to see your career matches.</p>' : `
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
              ${recRes.rows.map((r, idx) => `
                <div style="border:1px solid ${idx===0?CL:'#e5e7eb'};border-radius:10px;padding:16px;${idx===0?'background:'+CBG:''}">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
                    <div>
                      ${idx===0?'<span style="font-size:11px;color:'+CSUCCESS+';font-weight:600">★ BEST MATCH</span><br>':''}
                      <span style="font-size:16px;font-weight:600;color:${CTEXTC}">${esc(r.title)}</span>
                    </div>
                    <span style="font-size:20px;font-weight:700;color:${r.match_percent>=75?CSUCCESS:r.match_percent>=50?CWARN:CDANGER}">${r.match_percent}%</span>
                  </div>
                  <p style="font-size:12px;color:${CTEXTM};margin-bottom:8px;line-height:1.4">${esc(r.description)}</p>
                  <div style="font-size:11px;color:${CTEXTM};line-height:1.6">
                    <div><strong>Education:</strong> ${esc(r.education_level)}</div>
                    <div><strong>Subjects:</strong> ${esc(r.required_subjects)}</div>
                    <div><strong>Salary:</strong> ${esc(r.salary_range)}</div>
                    <div style="font-size:10px;color:${CTEXTM};margin-top:2px">Source: ${esc(r.source)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <a href="/career-guidance/universities" style="display:inline-block;background:${C};color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500">🎓 Find University Programs</a>
          <a href="/career-guidance/counselling" style="display:inline-block;background:#fff;color:${C};border:2px solid ${C};padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500">📝 Book Counselling Session</a>
        </div>
      </div>`;
    res.send(renderPage('Career Profile', html, req.session.user));
  }));

  // Counselling Notes — List
  app.get('/career-guidance/counselling', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';
    const isCounsellor = req.session.user.role === 'admin' || req.session.user.role === 'counsellor';

    let sessions;
    if (isCounsellor) {
      sessions = await pool.query(
        `SELECT cs.*, u.name AS student_name FROM ${prefix}career_counselling_sessions cs LEFT JOIN users u ON u.id=cs.student_id WHERE cs.tenant_id=$1 ORDER BY cs.session_date DESC, cs.created_at DESC LIMIT 50`,
        [tid]
      );
    } else {
      sessions = await pool.query(
        `SELECT * FROM ${prefix}career_counselling_sessions WHERE tenant_id=$1 AND student_id=$2 ORDER BY session_date DESC, created_at DESC`,
        [tid, uid]
      );
    }

    const html = `
      ${careerNav('coun')}
      <div style="max-width:900px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
          <h1 style="font-size:24px;font-weight:700;color:${CTEXTC}">📝 Counselling Sessions</h1>
          ${isCounsellor ? `<a href="/career-guidance/counselling/new" style="background:${C};color:#fff;padding:8px 20px;border-radius:8px;text-decoration:none;font-weight:500;font-size:14px">+ New Session</a>` : ''}
        </div>

        ${sessions.rows.length === 0 ? '<div style="text-align:center;padding:48px 20px;color:'+CTEXTM+'"><p style="font-size:16px;margin-bottom:8px">No counselling sessions yet.</p><p>Your career counsellor can record session notes here.</p></div>' : `
          <div style="display:grid;gap:12px">
            ${sessions.rows.map(s => `
              <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;transition:box-shadow 0.15s" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.06)'" onmouseout="this.style.boxShadow='none'">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:8px">
                  <div>
                    <div style="font-weight:600;color:${CTEXTC};font-size:15px">
                      ${isCounsellor ? esc(s.student_name || 'Student #'+s.student_id) + ' — ' : ''}
                      ${esc(s.topic || 'General Career Discussion')}
                    </div>
                    <div style="font-size:12px;color:${CTEXTM};margin-top:2px">📅 ${esc(s.session_date)}${s.follow_up_date ? ' &nbsp;|&nbsp; Follow-up: '+esc(s.follow_up_date) : ''}</div>
                  </div>
                  ${isCounsellor ? `<a href="/career-guidance/counselling/edit/${s.id}" style="color:${C};font-size:13px;text-decoration:none">Edit</a>` : ''}
                </div>
                ${s.notes ? `<p style="font-size:13px;color:${CTEXTC};line-height:1.5;margin-bottom:6px">${esc(s.notes).substring(0,300)}${s.notes.length>300?'...':''}</p>` : ''}
                ${s.action_items ? `<div style="font-size:12px;color:${CTEXTM}"><strong>Action Items:</strong> ${esc(s.action_items)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        `}
      </div>`;
    res.send(renderPage('Counselling Sessions', html, req.session.user));
  }));

  // New Counselling Session (counsellor only)
  app.get('/career-guidance/counselling/new', requireAuth, ah(async (req, res) => {
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'counsellor') {
      return res.status(403).send('Access denied. Counsellor role required.');
    }
    const tid = opts.tenantId || 'default';

    // Get students list
    let students = [];
    try {
      const sRes = await pool.query(`SELECT id, name FROM users WHERE tenant_id=$1 AND role='student' ORDER BY name LIMIT 200`, [tid]);
      students = sRes.rows;
    } catch(e) { /* no users table */ }

    const html = `
      ${careerNav('coun')}
      <div style="max-width:700px">
        <h1 style="font-size:24px;font-weight:700;color:${CTEXTC};margin-bottom:20px">📝 New Counselling Session</h1>
        <form method="POST" action="/career-guidance/counselling/new" role="form" aria-label="New counselling session form">
          <div style="margin-bottom:16px">
            <label for="student_id" style="display:block;font-size:14px;font-weight:600;color:${CTEXTC};margin-bottom:6px">Student *</label>
            <select name="student_id" id="student_id" required style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box">
              <option value="">— Select student —</option>
              ${students.map(s => `<option value="${s.id}">${esc(s.name || 'Student #'+s.id)}</option>`).join('')}
            </select>
          </div>
          <div style="margin-bottom:16px">
            <label for="session_date" style="display:block;font-size:14px;font-weight:600;color:${CTEXTC};margin-bottom:6px">Session Date *</label>
            <input type="date" name="session_date" id="session_date" value="${new Date().toISOString().split('T')[0]}" required style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box" />
          </div>
          <div style="margin-bottom:16px">
            <label for="topic" style="display:block;font-size:14px;font-weight:600;color:${CTEXTC};margin-bottom:6px">Topic</label>
            <input type="text" name="topic" id="topic" placeholder="e.g., Career path discussion, Subject selection" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box" />
          </div>
          <div style="margin-bottom:16px">
            <label for="notes" style="display:block;font-size:14px;font-weight:600;color:${CTEXTC};margin-bottom:6px">Session Notes</label>
            <textarea name="notes" id="notes" rows="6" placeholder="Record discussion points, observations, student concerns..." style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical"></textarea>
          </div>
          <div style="margin-bottom:16px">
            <label for="action_items" style="display:block;font-size:14px;font-weight:600;color:${CTEXTC};margin-bottom:6px">Action Items</label>
            <textarea name="action_items" id="action_items" rows="3" placeholder="e.g., Research university programs, Meet with subject teacher..." style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical"></textarea>
          </div>
          <div style="margin-bottom:20px">
            <label for="follow_up_date" style="display:block;font-size:14px;font-weight:600;color:${CTEXTC};margin-bottom:6px">Follow-up Date</label>
            <input type="date" name="follow_up_date" id="follow_up_date" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box" />
          </div>
          <button type="submit" style="background:${C};color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer">Save Session</button>
        </form>
      </div>`;
    res.send(renderPage('New Counselling Session', html, req.session.user));
  }));

  app.post('/career-guidance/counselling/new', requireAuth, ah(async (req, res) => {
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'counsellor') {
      return res.status(403).send('Access denied.');
    }
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';

    await pool.query(
      `INSERT INTO ${prefix}career_counselling_sessions (tenant_id,student_id,counsellor_id,session_date,topic,notes,action_items,follow_up_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, parseInt(req.body.student_id), req.session.user.id, req.body.session_date, req.body.topic || '', req.body.notes || '', req.body.action_items || '', req.body.follow_up_date || null]
    );

    audit('counselling_create', { student_id: req.body.student_id, counsellor_id: req.session.user.id });
    req.session.flash = { type: 'success', msg: 'Counselling session saved.' };
    res.redirect('/career-guidance/counselling');
  }));

  // Edit Counselling Session
  app.get('/career-guidance/counselling/edit/:id', requireAuth, ah(async (req, res) => {
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'counsellor') {
      return res.status(403).send('Access denied.');
    }
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';

    const session = await pool.query(
      `SELECT * FROM ${prefix}career_counselling_sessions WHERE tenant_id=$1 AND id=$2`,
      [tid, parseInt(req.params.id)]
    );
    if (session.rows.length === 0) return res.status(404).send('Session not found.');
    const s = session.rows[0];

    const html = `
      ${careerNav('coun')}
      <div style="max-width:700px">
        <h1 style="font-size:24px;font-weight:700;color:${CTEXTC};margin-bottom:20px">📝 Edit Session #${s.id}</h1>
        <form method="POST" action="/career-guidance/counselling/edit/${s.id}" role="form" aria-label="Edit counselling session">
          <div style="margin-bottom:16px">
            <label for="topic" style="display:block;font-size:14px;font-weight:600;color:${CTEXTC};margin-bottom:6px">Topic</label>
            <input type="text" name="topic" id="topic" value="${esc(s.topic)}" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box" />
          </div>
          <div style="margin-bottom:16px">
            <label for="notes" style="display:block;font-size:14px;font-weight:600;color:${CTEXTC};margin-bottom:6px">Session Notes</label>
            <textarea name="notes" id="notes" rows="8" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical">${esc(s.notes)}</textarea>
          </div>
          <div style="margin-bottom:16px">
            <label for="action_items" style="display:block;font-size:14px;font-weight:600;color:${CTEXTC};margin-bottom:6px">Action Items</label>
            <textarea name="action_items" id="action_items" rows="3" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical">${esc(s.action_items)}</textarea>
          </div>
          <div style="margin-bottom:16px">
            <label for="follow_up_date" style="display:block;font-size:14px;font-weight:600;color:${CTEXTC};margin-bottom:6px">Follow-up Date</label>
            <input type="date" name="follow_up_date" id="follow_up_date" value="${s.follow_up_date || ''}" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;box-sizing:border-box" />
          </div>
          <button type="submit" style="background:${C};color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer">Update Session</button>
        </form>
      </div>`;
    res.send(renderPage('Edit Session', html, req.session.user));
  }));

  app.post('/career-guidance/counselling/edit/:id', requireAuth, ah(async (req, res) => {
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'counsellor') {
      return res.status(403).send('Access denied.');
    }
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';

    await pool.query(
      `UPDATE ${prefix}career_counselling_sessions SET topic=$1, notes=$2, action_items=$3, follow_up_date=$4 WHERE tenant_id=$5 AND id=$6`,
      [req.body.topic || '', req.body.notes || '', req.body.action_items || '', req.body.follow_up_date || null, tid, parseInt(req.params.id)]
    );

    audit('counselling_update', { session_id: req.params.id });
    req.session.flash = { type: 'success', msg: 'Session updated.' };
    res.redirect('/career-guidance/counselling');
  }));

  // API: Get recommendations JSON
  app.get('/career-guidance/api/recommendations', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';

    const recs = await pool.query(
      `SELECT cl.title, cl.category, cl.description, cl.required_subjects, cl.education_level, cl.salary_range, cl.skills_needed, cl.outlook, cr.match_percent, cr.source FROM ${prefix}career_recommendations cr JOIN ${prefix}career_library cl ON cl.id=cr.career_library_id WHERE cr.tenant_id=$1 AND cr.student_id=$2 ORDER BY cr.match_percent DESC LIMIT 20`,
      [tid, uid]
    );
    res.json(recs.rows);
  }));

  // API: Get aptitude scores JSON
  app.get('/career-guidance/api/aptitude-scores', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const tid = opts.tenantId || 'default';
    const prefix = opts.tablePrefix || '';

    const results = await pool.query(
      `SELECT section, score, total FROM ${prefix}aptitude_tests WHERE tenant_id=$1 AND student_id=$2 AND completed_at IS NOT NULL ORDER BY section`,
      [tid, uid]
    );
    res.json(results.rows);
  }));

  // ─── Recommendation Engine ───────────────────────────────────────

  async function calculateRecommendations(studentId, tid, prefix) {
    // Get all aptitude scores
    const tests = await pool.query(
      `SELECT section, score, total FROM ${prefix}aptitude_tests WHERE tenant_id=$1 AND student_id=$2 AND completed_at IS NOT NULL`,
      [tid, studentId]
    );

    if (tests.rows.length === 0) return;

    const pctScores = {};
    tests.rows.forEach(r => {
      pctScores[r.section] = r.total > 0 ? Math.round(r.score / r.total * 100) : 0;
    });

    // Get all careers
    const careers = await pool.query(`SELECT * FROM ${prefix}career_library WHERE tenant_id=$1`, [tid]);

    await pool.query(`DELETE FROM ${prefix}career_recommendations WHERE tenant_id=$1 AND student_id=$2 AND source='aptitude'`, [tid, studentId]);

    for (const career of careers.rows) {
      const aptKeys = career.aptitude_keys.split(',').map(k => k.trim());
      let totalWeight = 0;
      let matchedWeight = 0;

      aptKeys.forEach(key => {
        totalWeight += 1;
        if (pctScores[key] !== undefined) {
          matchedWeight += pctScores[key] / 100;
        }
      });

      const matchPct = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0;

      if (matchPct >= 10) {
        await pool.query(
          `INSERT INTO ${prefix}career_recommendations (tenant_id,student_id,career_library_id,match_percent,source) VALUES ($1,$2,$3,$4,'aptitude') ON CONFLICT DO NOTHING`,
          [tid, studentId, career.id, matchPct]
        );
      }
    }
  }

  async function calculateInterestMatches(studentId, tid, prefix) {
    const interests = await pool.query(
      `SELECT interest_id FROM ${prefix}interest_responses WHERE tenant_id=$1 AND student_id=$2`,
      [tid, studentId]
    );

    if (interests.rows.length === 0) return;

    const interestIds = new Set(interests.rows.map(r => r.interest_id));

    // Map interests to career categories
    const catMap = {};
    INTERESTS.forEach(i => {
      if (interestIds.has(i.id)) {
        if (!catMap[i.category]) catMap[i.category] = 0;
        catMap[i.category]++;
      }
    });

    const totalInterests = INTERESTS.length;
    const maxCatCount = Math.max(...Object.values(catMap), 1);

    // Get careers
    const careers = await pool.query(`SELECT * FROM ${prefix}career_library WHERE tenant_id=$1`, [tid]);

    await pool.query(`DELETE FROM ${prefix}career_recommendations WHERE tenant_id=$1 AND student_id=$2 AND source='interests'`, [tid, studentId]);

    for (const career of careers.rows) {
      const catCount = catMap[career.category] || 0;
      const categoryMatch = catCount / maxCatCount;
      const breadthMatch = Object.keys(catMap).includes(career.category) ? 0.5 : 0;
      const matchPct = Math.round((categoryMatch * 0.7 + breadthMatch * 0.3) * 100);

      if (matchPct >= 10) {
        await pool.query(
          `INSERT INTO ${prefix}career_recommendations (tenant_id,student_id,career_library_id,match_percent,source) VALUES ($1,$2,$3,$4,'interests') ON CONFLICT DO NOTHING`,
          [tid, studentId, career.id, matchPct]
        );
      }
    }
  }

  // ─── Return module info ──────────────────────────────────────────
  return { version: '1.0.0', name: 'career-guidance' };
};
