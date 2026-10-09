// Every record type the app tracks, and how it is shown and edited.
// Field types: text, textarea, date, select, number, range, tags, ref, check, url, photos

const today = () => new Date().toISOString().slice(0, 10);

export const SECTIONS = [
  { id: 'lab', label: 'Lab', kinds: ['experiment', 'protocol', 'inventory'] },
  { id: 'research', label: 'Research', kinds: ['project', 'article', 'task', 'paper'] },
  { id: 'phd', label: 'PhD', kinds: ['application', 'professor'] },
  { id: 'profile', label: 'Profile', kinds: ['publication', 'talk', 'award'] },
];

export const APP_OPEN = ['Researching', 'Contacted supervisor', 'Preparing'];
export const APP_STATUS = ['Researching', 'Contacted supervisor', 'Preparing', 'Submitted', 'Interview', 'Offer', 'Accepted', 'Rejected', 'Declined'];
// Every application gets these folders to start with (the same layout as the owner's own PC folders).
export const APP_FOLDERS = ['01_Program_Info', '02_My_Profile', '03_Professors', '04_Templates_General'];
export const PROF_STATUS = ['Not contacted', 'Emailed', 'Follow-up sent', 'Replied', 'Meeting / interview', 'Positive', 'No position', 'No reply'];
// Every research article starts with these folders.
export const ART_FOLDERS = ['01_Manuscript', '02_Figures', '03_Data_Analysis', '04_Supplementary', '05_Submission_Reviews'];
export const ART_STATUS = ['Idea', 'Drafting', 'Internal review', 'Submitted', 'Under review', 'Revision', 'Accepted', 'Published', 'Rejected'];
const ART_WORKING = ['Idea', 'Drafting', 'Internal review', 'Revision'];

// Where an application stands, for the PhD list: Ongoing, Upcoming, Missed or Done.
export const APP_GROUPS = [
  { id: 'ongoing', label: 'Ongoing', hint: 'Started — preparing, contacted, submitted, interview or offer' },
  { id: 'upcoming', label: 'Upcoming', hint: 'Not started yet' },
  { id: 'missed', label: 'Missed', hint: 'Deadline passed before submitting' },
  { id: 'done', label: 'Done', hint: 'Accepted, rejected or declined' },
];
export function appGroup(x) {
  const st = x.status || 'Researching';
  if (['Accepted', 'Rejected', 'Declined'].includes(st)) return 'done';
  if (APP_OPEN.includes(st) && x.deadline && x.deadline < today()) return 'missed';
  if (st === 'Researching') return 'upcoming';
  return 'ongoing';
}
export const APP_DOCS = ['CV', 'Statement of purpose', 'Research proposal', 'References', 'Transcripts', 'Language test', 'Publications', 'Portfolio / writing sample'];

export const KINDS = {
  experiment: {
    label: 'Experiment', plural: 'Experiments', color: 'var(--wet)',
    sort: (a, b) => (b.date || '').localeCompare(a.date || ''),
    sub: (x, ctx) => [x.date, ctx.projectName(x.project)].filter(Boolean).join(' · '),
    badge: x => x.status,
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Fowlpox passage 6 in duck eggs' },
      { key: 'date', label: 'Date', type: 'date', default: today },
      { key: 'status', label: 'Status', type: 'select', options: ['Planned', 'In progress', 'Completed', 'Failed', 'Repeated'], default: () => 'In progress' },
      { key: 'project', label: 'Project', type: 'ref', ref: 'project' },
      { key: 'protocol', label: 'Protocol used', type: 'ref', ref: 'protocol' },
      { key: 'objective', label: 'Objective', type: 'textarea' },
      { key: 'materials', label: 'Materials & reagents', type: 'textarea' },
      { key: 'procedure', label: 'Procedure', type: 'textarea', rows: 6 },
      { key: 'results', label: 'Results / observations', type: 'textarea', rows: 6 },
      { key: 'conclusion', label: 'Conclusion & next steps', type: 'textarea' },
      { key: 'photos', label: 'Photos (gels, plates, setups)', type: 'photos' },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
  },
  protocol: {
    label: 'Protocol', plural: 'Protocols', color: 'var(--wet)',
    sort: (a, b) => (a.title || '').localeCompare(b.title || ''),
    sub: x => [x.category, x.version && 'v' + x.version].filter(Boolean).join(' · '),
    fields: [
      { key: 'title', label: 'Protocol name', type: 'text', required: true, placeholder: 'e.g. Agarose gel electrophoresis (1%)' },
      { key: 'category', label: 'Category', type: 'select', options: ['Molecular biology', 'Microbiology', 'Virology', 'Immunoassay', 'Biochemistry', 'Analytical', 'Computational', 'Other'] },
      { key: 'version', label: 'Version', type: 'text', placeholder: '1.0' },
      { key: 'purpose', label: 'Purpose', type: 'textarea' },
      { key: 'materials', label: 'Materials & reagents', type: 'textarea' },
      { key: 'steps', label: 'Steps', type: 'textarea', rows: 8 },
      { key: 'notes', label: 'Notes & troubleshooting', type: 'textarea' },
      { key: 'source', label: 'Source / reference', type: 'url' },
      { key: 'photos', label: 'Photos', type: 'photos' },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
  },
  inventory: {
    label: 'Sample / reagent', plural: 'Inventory', color: 'var(--wet)',
    sort: (a, b) => (a.title || '').localeCompare(b.title || ''),
    sub: x => [x.type, x.quantity, x.location].filter(Boolean).join(' · '),
    badge: x => x.status,
    warn: x => {
      if (!x.expiry || x.status === 'Used up') return null;
      const days = Math.round((new Date(x.expiry) - new Date(today())) / 864e5);
      if (days < 0) return 'Expired';
      if (days <= 30) return `Expires in ${days} d`;
      return null;
    },
    fields: [
      { key: 'title', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Taq polymerase / Serum sample S12' },
      { key: 'type', label: 'Type', type: 'select', options: ['Sample', 'Reagent', 'Kit', 'Antibody', 'Primer', 'Strain / cell line', 'Consumable', 'Other'] },
      { key: 'quantity', label: 'Quantity', type: 'text', placeholder: 'e.g. 5 mL, 2 tubes' },
      { key: 'location', label: 'Storage location', type: 'text', placeholder: 'e.g. −20 °C, rack 2, box B' },
      { key: 'lot', label: 'Lot / batch', type: 'text' },
      { key: 'received', label: 'Received', type: 'date' },
      { key: 'expiry', label: 'Expiry', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['In stock', 'Low', 'Used up', 'Expired'], default: () => 'In stock' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  project: {
    label: 'Project', plural: 'Projects', color: 'var(--dry)',
    sort: (a, b) => statusRank(a.status) - statusRank(b.status) || (a.title || '').localeCompare(b.title || ''),
    sub: (x, ctx) => [x.area, x.target && 'target ' + x.target, ctx && ctx.activity && ctx.activity(x)].filter(Boolean).join(' · '),
    badge: x => x.status,
    progress: x => Number(x.progress) || 0,
    fields: [
      { key: 'title', label: 'Project name', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Idea', 'Active', 'On hold', 'Done'], default: () => 'Active' },
      { key: 'area', label: 'Area', type: 'select', options: ['Wet lab', 'Computational', 'Both'] },
      { key: 'progress', label: 'Progress', type: 'range', default: () => 0 },
      { key: 'start', label: 'Start date', type: 'date' },
      { key: 'target', label: 'Target date', type: 'date' },
      { key: 'description', label: 'Description', type: 'textarea', rows: 5 },
      { key: 'links', label: 'Links (repo, docs, data)', type: 'textarea', rows: 3 },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
  },
  task: {
    label: 'Task', plural: 'Tasks', color: 'var(--dry)',
    sort: (a, b) => (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999') || prioRank(a.priority) - prioRank(b.priority),
    sub: (x, ctx) => [x.due && dueLabel(x.due), ctx.projectName(x.project)].filter(Boolean).join(' · '),
    badge: x => (x.priority === 'High' ? 'High' : null),
    checkable: true,
    calendar: x => x.due && !x.done && { date: x.due, title: x.title, details: x.notes || '' },
    fields: [
      { key: 'title', label: 'Task', type: 'text', required: true },
      { key: 'due', label: 'Due date', type: 'date' },
      { key: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'], default: () => 'Medium' },
      { key: 'project', label: 'Project', type: 'ref', ref: 'project' },
      { key: 'done', label: 'Done', type: 'check' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  article: {
    label: 'Research article', plural: 'Articles', color: 'var(--accent)', workspace: true,
    sort: (a, b) => artRank(a.status) - artRank(b.status) || (a.target || '9999').localeCompare(b.target || '9999') || (b.updatedAt || 0) - (a.updatedAt || 0),
    sub: (x, ctx) => [x.journal, x.target && ART_WORKING.includes(x.status || 'Drafting') && 'target ' + x.target, ctx && ctx.activity && ctx.activity(x)].filter(Boolean).join(' · '),
    badge: x => x.status,
    progress: x => Number(x.progress) || 0,
    warn: x => {
      if (!x.target || !ART_WORKING.includes(x.status || 'Drafting')) return null;
      const days = Math.round((new Date(x.target) - new Date(today())) / 864e5);
      if (days < 0) return 'Target passed';
      if (days <= 7) return days === 0 ? 'Due today' : `Due in ${days} d`;
      return null;
    },
    calendar: x => x.target && ART_WORKING.includes(x.status || 'Drafting') && { date: x.target, title: 'Submit article: ' + x.title, details: [x.journal, x.repo].filter(Boolean).join(' · ') },
    fields: [
      { key: 'title', label: 'Working title', type: 'text', required: true, placeholder: 'e.g. Bacterial HLA ligands do not survive error control' },
      { key: 'status', label: 'Stage', type: 'select', options: ART_STATUS, default: () => 'Drafting' },
      { key: 'journal', label: 'Target journal', type: 'text' },
      { key: 'progress', label: 'Writing progress', type: 'range', default: () => 0 },
      { key: 'target', label: 'Target submission date', type: 'date' },
      { key: 'submitted', label: 'Submitted on', type: 'date' },
      { key: 'authors', label: 'Authors', type: 'text', placeholder: 'Rahman MH, …' },
      { key: 'project', label: 'Project', type: 'ref', ref: 'project' },
      { key: 'repo', label: 'GitHub repository', type: 'url', placeholder: 'https://github.com/Hafij-BGE/…' },
      { key: 'doi', label: 'DOI / preprint link', type: 'url' },
      { key: 'links', label: 'Links (code, data, accessions)', type: 'links' },
      { key: 'refs', label: 'References', type: 'refs' },
      { key: 'notes', label: 'README (aim, key results, figure list, to-dos — shown at the top of the folder)', type: 'textarea', rows: 6 },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
  },
  // Notepad pages (handwriting + typed text). They belong to a section or a folder ("where"),
  // not to a tab of their own.
  note: {
    label: 'Note', plural: 'Notes', color: 'var(--amber)', notepad: true,
    sort: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    sub: x => [x.pages > 1 ? `${x.pages} pages` : '', x.updatedAt ? new Date(x.updatedAt).toLocaleDateString() : ''].filter(Boolean).join(' · '),
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'notes', label: 'Typed text', type: 'textarea', rows: 8 },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
  },
  paper: {
    label: 'Paper', plural: 'Reading list', color: 'var(--dry)',
    sort: (a, b) => readRank(a.status) - readRank(b.status) || (b.year || 0) - (a.year || 0),
    sub: x => [x.authors, x.year, x.journal].filter(Boolean).join(' · '),
    badge: x => x.status,
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'authors', label: 'Authors', type: 'text' },
      { key: 'year', label: 'Year', type: 'number' },
      { key: 'journal', label: 'Journal', type: 'text' },
      { key: 'doi', label: 'DOI or link', type: 'url', placeholder: '10.xxxx/… or https://…' },
      { key: 'status', label: 'Status', type: 'select', options: ['To read', 'Reading', 'Read'], default: () => 'To read' },
      { key: 'project', label: 'Relevant to project', type: 'ref', ref: 'project' },
      { key: 'notes', label: 'Notes & key points', type: 'textarea', rows: 6 },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
  },
  application: {
    label: 'PhD application', plural: 'Applications', color: 'var(--phd)',
    sort: (a, b) => (closed(a) - closed(b)) || (a.deadline || '9999').localeCompare(b.deadline || '9999'),
    sub: x => [x.university, x.country, x.deadline && 'deadline ' + x.deadline].filter(Boolean).join(' · '),
    badge: x => x.status,
    warn: x => {
      if (!x.deadline || !APP_OPEN.includes(x.status || 'Researching')) return null;
      const days = Math.round((new Date(x.deadline) - new Date(today())) / 864e5);
      if (days < 0) return 'Deadline passed';
      if (days <= 14) return days === 0 ? 'Due today' : `Due in ${days} d`;
      return null;
    },
    calendar: x => x.deadline && { date: x.deadline, title: 'PhD application deadline: ' + [x.title, x.university].filter(Boolean).join(' — '), details: x.portal || '' },
    fields: [
      { key: 'title', label: 'Position / programme', type: 'text', required: true, placeholder: 'e.g. PhD in Computational Immunology' },
      { key: 'university', label: 'University / institute', type: 'text' },
      { key: 'country', label: 'Country', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: APP_STATUS, default: () => 'Researching' },
      { key: 'deadline', label: 'Application deadline', type: 'date' },
      { key: 'supervisor', label: 'Supervisor / PI', type: 'text' },
      { key: 'supervisorEmail', label: 'Supervisor email', type: 'text' },
      { key: 'funding', label: 'Funding / scholarship', type: 'text', placeholder: 'e.g. fully funded, DAAD, Marie Curie' },
      { key: 'portal', label: 'Application portal / ad link', type: 'url' },
      { key: 'documents', label: 'Documents ready', type: 'checklist', options: APP_DOCS },
      { key: 'notes', label: 'README (requirements, steps, interview prep — shown at the top of the folder)', type: 'textarea', rows: 6 },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
  },
  professor: {
    label: 'Professor', plural: 'Professors', color: 'var(--phd)',
    sort: (a, b) => profRank(a.status) - profRank(b.status) || (a.followUp || '9999').localeCompare(b.followUp || '9999') || (a.title || '').localeCompare(b.title || ''),
    sub: (x, ctx) => [x.institute, ctx.title(x.application)].filter(Boolean).join(' · '),
    badge: x => x.status,
    warn: x => {
      if (!x.followUp || !['Emailed', 'Follow-up sent'].includes(x.status)) return null;
      const days = Math.round((new Date(x.followUp) - new Date(today())) / 864e5);
      if (days < 0) return 'Follow up now';
      if (days <= 3) return days === 0 ? 'Follow up today' : `Follow up in ${days} d`;
      return null;
    },
    calendar: x => x.followUp && { date: x.followUp, title: 'Follow up with ' + x.title, details: [x.email, x.institute].filter(Boolean).join(' · ') },
    fields: [
      { key: 'title', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Prof. Dr. Anna Müller' },
      { key: 'application', label: 'Application', type: 'ref', ref: 'application' },
      { key: 'status', label: 'Contact status', type: 'select', options: PROF_STATUS, default: () => 'Not contacted' },
      { key: 'institute', label: 'Institute / group', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'website', label: 'Lab website', type: 'url' },
      { key: 'contacted', label: 'First email sent', type: 'date' },
      { key: 'followUp', label: 'Follow up on', type: 'date' },
      { key: 'research', label: 'Research focus', type: 'textarea' },
      { key: 'fit', label: 'Why this lab / talking points', type: 'textarea' },
      { key: 'notes', label: 'Notes (replies, meeting notes)', type: 'textarea', rows: 4 },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
  },
  publication: {
    label: 'Publication', plural: 'Publications', color: 'var(--accent)',
    sort: (a, b) => (b.year || 0) - (a.year || 0),
    sub: x => [x.venue, x.year].filter(Boolean).join(' · '),
    badge: x => x.status,
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'authors', label: 'Authors', type: 'text' },
      { key: 'venue', label: 'Journal / venue', type: 'text' },
      { key: 'year', label: 'Year', type: 'number' },
      { key: 'type', label: 'Type', type: 'select', options: ['Article', 'Review', 'Preprint', 'Conference paper', 'Book chapter', 'Thesis'] },
      { key: 'status', label: 'Status', type: 'select', options: ['Idea', 'Drafting', 'Submitted', 'Under review', 'Revision', 'Accepted', 'Published'], default: () => 'Drafting' },
      { key: 'doi', label: 'DOI or link', type: 'url' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  talk: {
    label: 'Talk / poster', plural: 'Talks & posters', color: 'var(--accent)',
    sort: (a, b) => (b.date || '').localeCompare(a.date || ''),
    sub: x => [x.type, x.event, x.date].filter(Boolean).join(' · '),
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'type', label: 'Type', type: 'select', options: ['Oral', 'Poster', 'Invited talk', 'Seminar', 'Workshop'] },
      { key: 'event', label: 'Event', type: 'text' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'coauthors', label: 'Co-authors', type: 'text' },
      { key: 'link', label: 'Link', type: 'url' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  award: {
    label: 'Award', plural: 'Awards', color: 'var(--accent)',
    sort: (a, b) => (b.year || 0) - (a.year || 0),
    sub: x => [x.issuer, x.year].filter(Boolean).join(' · '),
    fields: [
      { key: 'title', label: 'Award / scholarship', type: 'text', required: true },
      { key: 'issuer', label: 'Issued by', type: 'text' },
      { key: 'year', label: 'Year', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
};

function closed(x) { return ['Accepted', 'Rejected', 'Declined'].includes(x.status) ? 1 : 0; }
function artRank(s) { return { Revision: 0, Drafting: 1, 'Internal review': 2, Idea: 3, Submitted: 4, 'Under review': 5, Accepted: 6, Published: 7, Rejected: 8 }[s] ?? 1; }
function profRank(s) { return { Positive: 0, 'Meeting / interview': 1, Replied: 2, 'Follow-up sent': 3, Emailed: 4, 'Not contacted': 5, 'No reply': 6, 'No position': 7 }[s] ?? 5; }
function statusRank(s) { return { Active: 0, Idea: 1, 'On hold': 2, Done: 3 }[s] ?? 4; }
function prioRank(p) { return { High: 0, Medium: 1, Low: 2 }[p] ?? 3; }
function readRank(s) { return { Reading: 0, 'To read': 1, Read: 2 }[s] ?? 3; }

export function dueLabel(due) {
  const days = Math.round((new Date(due) - new Date(today())) / 864e5);
  if (days < 0) return `${-days} d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= 7) return `Due in ${days} d`;
  return 'Due ' + due;
}

export function textOf(item) {
  const k = KINDS[item.kind];
  if (!k) return '';
  const extra = [].concat(...k.fields.filter(f => f.type === 'links' || f.type === 'refs').map(f => (item[f.key] || [])
    .map(x => [x.label, x.url, x.title, x.text, x.doi, x.authors, x.journal].filter(Boolean).join(' '))));
  return k.fields.filter(f => ['text', 'textarea', 'url', 'select'].includes(f.type))
    .map(f => item[f.key] || '').concat(item.tags || [], extra).join(' ').toLowerCase();
}

// One-tap import of what is already on the CV, so the profile isn't empty on day one.
export const CV_SEED = [
  { kind: 'publication', title: 'Phyllanthus emblica (Amla) methanolic extract regulates multiple checkpoints in 15-lipoxygenase mediated inflammopathies: computational simulation and in vitro evidence', year: 2023, type: 'Article', status: 'Published', doi: 'https://doi.org/10.1016/j.jsps.2023.06.014' },
  { kind: 'publication', title: "In vitro and in silico investigation of garlic's (Allium sativum) bioactivity against 15-lipoxygenase mediated inflammopathies", year: 2023, type: 'Article', status: 'Published', doi: 'https://doi.org/10.34172/jhp.2023.31' },
  { kind: 'publication', title: 'Molecular optimization, docking, and dynamic simulation profiling of selective aromatic phytochemical ligands in blocking the SARS-CoV-2 S protein attachment to ACE2 receptor', year: 2021, type: 'Article', status: 'Published', doi: 'https://doi.org/10.5455/javar.2021.h481' },
  { kind: 'talk', title: 'Integrated CRISPR–microfluidic platform for automated point-of-care pathogen detection', type: 'Oral', event: 'DEUISGR 2025 (December 2025)', location: 'Dokuz Eylül University, İzmir', coauthors: 'Ö. Cihanbeğendi' },
  { kind: 'talk', title: 'Molecular docking of phytochemicals as potential inhibitors of breast cancer targeting HER-2', type: 'Poster', event: 'IPPC 2020', notes: 'Outstanding Poster, 243 submissions (Life Science)' },
  { kind: 'award', title: 'Türkiye Bursları Scholarship', issuer: 'Türkiye Bursları', year: 2024 },
  { kind: 'award', title: 'National Science and Technology (NST) Fellowship', issuer: 'Government of Bangladesh', year: 2023 },
  { kind: 'award', title: 'Merit Scholarships (2018, 2019, 2021, 2022)', issuer: 'Khulna University', year: 2022 },
  { kind: 'project', title: 'Bacterial HLA ligands in tumour immunopeptidomes (MSc thesis)', status: 'Active', area: 'Computational', progress: 80, links: 'https://github.com/Hafij-BGE/microbial-immunopeptidome-attribution' },
  { kind: 'project', title: 'SH3 mechanism atlas — phase 2 external validation', status: 'Active', area: 'Computational', progress: 50, links: 'https://github.com/Hafij-BGE/sh3-mechanism' },
  { kind: 'project', title: 'PXD024871 sequence-only CNN benchmark', status: 'Done', area: 'Computational', progress: 100, links: 'https://github.com/Hafij-BGE/PXD024871_mapping' },
  { kind: 'project', title: 'Deep learning prediction of protein–protein interactions', status: 'Active', area: 'Computational', progress: 10 },
  { kind: 'project', title: 'Attenuated fowlpox vaccine from a wild isolate (MSc thesis, BAU)', status: 'Done', area: 'Wet lab', progress: 100 },
];
