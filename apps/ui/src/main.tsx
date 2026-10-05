import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api } from './api';
import './styles.css';

const SCREENS = ['Select', 'Translate', 'Agree', 'Prove original', 'Optimize', 'Deliver'] as const;

interface Check { id: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string; fix?: string }

function Doctor() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<Check[]>('GET', '/api/doctor').then(setChecks, (e) => setErr(String(e.message))); }, []);
  if (err) return <p class="err">{err}</p>;
  if (!checks) return <p class="muted">Checking your toolchain…</p>;
  return (
    <ul class="checks">
      {checks.map((c) => (
        <li key={c.id} class={c.status}>
          <b>{c.label}</b> <span>{c.detail}</span>
          {c.fix && <code>{c.fix}</code>}
        </li>
      ))}
    </ul>
  );
}

function App() {
  const [step] = useState(0);
  return (
    <main>
      <header>
        <h1>Faithful</h1>
        <p class="muted">Provably the same, measurably faster.</p>
      </header>
      <ol class="steps">
        {SCREENS.map((s, i) => <li key={s} class={i === step ? 'on' : ''}>{s}</li>)}
      </ol>
      <section>
        <h2>Toolchain</h2>
        <Doctor />
      </section>
    </main>
  );
}

render(<App />, document.getElementById('app')!);
