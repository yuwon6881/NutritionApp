import {Brand} from './ui/Brand';
import {ArrowLeft, Shield, FileText, HelpCircle} from 'lucide-react';

interface PolicyLayoutProps {
  title: string;
  subtitle: string;
  icon: typeof Shield;
  children: React.ReactNode;
}

function PolicyLayout({title, subtitle, icon: Icon, children}: PolicyLayoutProps) {
  return (
    <div className="policy-page-layout">
      <header className="policy-header">
        <div className="policy-brand">
          <Brand size={32} />
          <span className="brand-name">Nutrition App</span>
        </div>
        <a href="/" className="back-link">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Back to Nutrition App</span>
        </a>
      </header>

      <main className="policy-content" id="main-content">
        <div className="policy-title-block">
          <div className="policy-icon-wrapper" aria-hidden="true">
            <Icon size={28} />
          </div>
          <div>
            <h1>{title}</h1>
            <p className="policy-subtitle">{subtitle}</p>
          </div>
        </div>

        <article className="policy-body panel">{children}</article>
      </main>

      <footer className="policy-footer">
        <nav aria-label="Legal and help links">
          <a href="/privacy">Privacy Policy</a>
          <span aria-hidden="true">·</span>
          <a href="/terms">Terms of Service</a>
          <span aria-hidden="true">·</span>
          <a href="/help/google-health">Google Health Help & Data Deletion</a>
        </nav>
        <p>© 2026 NutritionApp. All rights reserved.</p>
      </footer>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <PolicyLayout
      title="Privacy Policy"
      subtitle="Last updated September 2026"
      icon={Shield}
    >
      <section>
        <h2>1. Overview</h2>
        <p>
          NutritionApp is a personal nutrition and fitness tracking application designed with privacy, tenant isolation, and cryptographic data protection at its core. We do not sell your personal information or share your health data with advertisers.
        </p>
      </section>

      <section>
        <h2>2. Information We Collect</h2>
        <p>
          When you use NutritionApp, we store the information necessary to provide your nutrition diary and progress tracking:
        </p>
        <ul>
          <li><strong>Account Information:</strong> Your chosen username and salted, hashed password.</li>
          <li><strong>Diary Entries & Foods:</strong> Foods, portion sizes, macronutrient details, recipes, and timestamps you log.</li>
          <li><strong>Body Measurements & Weigh-Ins:</strong> Scale weights, trend calculations, optional body circumference measurements, and optional private physique photos.</li>
          <li><strong>Google Health Steps Data:</strong> If you connect Google Health, we read daily aggregated step counts for today and the preceding 30 calendar days.</li>
        </ul>
      </section>

      <section className="highlighted-policy-section">
        <h2>3. Google API Services User Data Policy & Limited Use Disclosure</h2>
        <p>
          NutritionApp&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p>
          Specifically regarding Google Health integration:
        </p>
        <ul>
          <li><strong>Read-only scope:</strong> We request only the <code>googlehealth.activity_and_fitness.readonly</code> scope. NutritionApp never writes, modifies, or deletes data in your Google Health account.</li>
          <li><strong>Rolling 31-day retention:</strong> We retain a rolling window of up to 31 calendar days of daily step totals. Older daily totals are automatically pruned.</li>
          <li><strong>Cryptographic protection at rest:</strong> Google Health OAuth refresh tokens, Google account identity values, and imported daily step history are encrypted at rest using Google Cloud Key Management Service (Cloud KMS). OAuth access tokens remain strictly in runtime memory and are never persisted to disk or logs.</li>
          <li><strong>No coaching or target influence:</strong> Imported step totals are purely informational and displayed for your personal reference. They are never factored into energy balance equations, expenditure trajectories, coaching proposals, or calorie targets.</li>
          <li><strong>No third-party transfer:</strong> Your Google Health step data is never transferred, shared, or sold to third parties, data brokers, or advertising platforms.</li>
          <li><strong>Human review restriction:</strong> NutritionApp personnel do not read or access your private step data.</li>
        </ul>
      </section>

      <section>
        <h2>4. Data Deletion and Revocation</h2>
        <p>
          You can disconnect Google Health at any time in <strong>Settings → Google Health → Disconnect</strong>. Disconnecting immediately:
        </p>
        <ul>
          <li>Revokes NutritionApp&apos;s authorization with Google upstream;</li>
          <li>Permanently deletes all imported 31-day step history records from NutritionApp servers;</li>
          <li>Destroys the stored encrypted OAuth refresh tokens.</li>
        </ul>
        <p>
          You can also revoke access directly from your{' '}
          <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">
            Google Account permissions page
          </a>
          . When an external revocation is detected, NutritionApp automatically deletes all imported step history and requires re-authorization.
        </p>
      </section>

      <section>
        <h2>5. Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or wish to request complete deletion of your account and associated data, contact us at{' '}
          <a href="mailto:privacy@nutritionapp.example.com">privacy@nutritionapp.example.com</a>.
        </p>
      </section>
    </PolicyLayout>
  );
}

export function TermsPage() {
  return (
    <PolicyLayout
      title="Terms of Service"
      subtitle="Last updated September 2026"
      icon={FileText}
    >
      <section>
        <h2>1. Acceptance of Terms</h2>
        <p>
          By creating an account or using NutritionApp, you agree to these Terms of Service. If you do not agree, do not use the application.
        </p>
      </section>

      <section>
        <h2>2. Informational and Personal Use Only</h2>
        <p>
          NutritionApp provides nutrition tracking, body weight analysis, and educational coaching models for personal information only. NutritionApp is not a medical device, healthcare provider, or licensed medical authority. Content, energy projections, and coaching recommendations do not constitute medical diagnosis, treatment, or dietary therapy. Consult a physician before undertaking significant changes to your diet or exercise routine.
        </p>
      </section>

      <section>
        <h2>3. Third-Party Integrations</h2>
        <p>
          Optional integrations with third-party providers (such as Google Health) are provided as-is and subject to the provider&apos;s availability and terms. You are responsible for managing your third-party authorizations.
        </p>
      </section>

      <section>
        <h2>4. Account Security</h2>
        <p>
          You are responsible for safeguarding your password and account credentials. NutritionApp employs tenant isolation, concurrency tokens, and encryption at rest to protect your records.
        </p>
      </section>

      <section>
        <h2>5. Termination</h2>
        <p>
          You may discontinue use or delete your account at any time. We reserve the right to suspend or terminate accounts that violate system integrity or security bounds.
        </p>
      </section>
    </PolicyLayout>
  );
}

export function GoogleHealthHelpPage() {
  return (
    <PolicyLayout
      title="Google Health Integration & Data Deletion"
      subtitle="Help, data policies, and deletion procedures"
      icon={HelpCircle}
    >
      <section>
        <h2>How Google Health Step Sync Works</h2>
        <p>
          NutritionApp offers an optional, read-only integration with Google Health via Google&apos;s Cloud REST API (using the <code>dailyRollUp</code> endpoint for the <code>steps</code> data type).
        </p>
        <p>
          When enabled, NutritionApp imports your daily step counts for today and the preceding 30 calendar days based on your profile time zone. Step counts are displayed on your Dashboard and Progress screen as an activity reference.
        </p>
      </section>

      <section>
        <h2>Security & Storage Architecture</h2>
        <ul>
          <li><strong>Cloud KMS Encryption:</strong> All stored Google tokens, user identifiers, and step history payloads are encrypted at rest using Google Cloud Key Management Service (KMS).</li>
          <li><strong>No Local Device Storage:</strong> Google Health step data is never cached in your browser&apos;s persistent IndexedDB or localStorage; it resides in temporary runtime memory only.</li>
          <li><strong>Isolation from Calorie Calculations:</strong> Step counts are purely informative. They do not alter your daily calorie targets, macro splits, adaptive expenditure algorithms, or check-in requirements.</li>
        </ul>
      </section>

      <section>
        <h2>How to Disconnect and Delete Your Step Data</h2>
        <p>
          You have complete control over your health data and can remove it at any time:
        </p>
        <ol>
          <li>Open NutritionApp and navigate to <strong>Settings</strong>.</li>
          <li>Scroll to the <strong>Google Health</strong> section.</li>
          <li>Click <strong>Disconnect</strong> and confirm the prompt.</li>
        </ol>
        <p>
          <strong>Immediate Effect:</strong> Disconnecting immediately calls Google&apos;s token revocation endpoint to revoke access, permanently deletes your stored Google credentials, and wipes all 31 days of imported step data from NutritionApp.
        </p>
      </section>

      <section>
        <h2>Revoking Access via Google Account</h2>
        <p>
          You can also revoke NutritionApp&apos;s authorization directly from Google:
        </p>
        <ol>
          <li>Go to <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">Google Account &gt; Third-party apps &amp; services</a>.</li>
          <li>Select <strong>NutritionApp</strong>.</li>
          <li>Click <strong>Delete all connections that you have with NutritionApp</strong>.</li>
        </ol>
        <p>
          Upon detecting external revocation during sync, NutritionApp immediately deletes all stored step records and resets the integration status to require re-authorization.
        </p>
      </section>

      <section>
        <h2>Manual Data Deletion Requests</h2>
        <p>
          To request complete deletion of all records associated with your NutritionApp account, email our privacy team at{' '}
          <a href="mailto:privacy@nutritionapp.example.com">privacy@nutritionapp.example.com</a>. Requests are fulfilled within 30 days.
        </p>
      </section>
    </PolicyLayout>
  );
}
