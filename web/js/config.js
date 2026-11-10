// Configurazione pubblica dell'app. La "publishable key" NON è un segreto:
// è pensata per stare nel browser; la sicurezza è garantita dalle regole RLS.
// NON inserire mai qui la service_role / secret key.
export const CONFIG = {
  supabaseUrl: 'https://vvhagrneqfnuzvthdlyx.supabase.co',
  anonKey: 'sb_publishable_ZFK7Z0SrTQPrZtcW4zvx3Q_AfOvhk9j',
  environment: 'prova',            // 'prova' | 'produzione'
  pdfBucket: 'workout-pdfs',
};
