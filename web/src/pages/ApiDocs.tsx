import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';

interface Param { name: string; in: 'path' | 'query'; required: boolean; description: string }
interface Op {
  tags: string[]; summary: string; 'x-scope': 'read' | 'control'; parameters: Param[];
  requestBody?: { content: { 'application/json': { schema: { required: string[]; properties: Record<string, { description: string }> } } } };
}
interface Spec { info: { description: string }; servers: { url: string }[]; paths: Record<string, Record<string, Op>> }

const METHOD_COLOR: Record<string, string> = { get: 'var(--ok)', post: 'var(--primary)', patch: 'var(--warn)', delete: 'var(--danger)' };

function Endpoint({ method, path, op, server }: { method: string; path: string; op: Op; server: string }) {
  const [open, setOpen] = useState(false);
  const body = op.requestBody?.content['application/json'].schema;
  const query = op.parameters.filter((p) => p.in === 'query');
  const pathParams = op.parameters.filter((p) => p.in === 'path' && p.name !== 'homeId');
  const example = [
    `curl${method === 'get' ? '' : ` -X ${method.toUpperCase()}`} "${server}${path}"`,
    '  -H "Authorization: Bearer $DEN_DUTY_TOKEN"',
    ...(body ? ['  -H "Content-Type: application/json"', `  -d '${JSON.stringify(Object.fromEntries(body.required.map((k) => [k, '…'])))}'`] : []),
  ].join(' \\\n');
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <button className="ghost" onClick={() => setOpen(!open)} aria-expanded={open}
        style={{ justifyContent: 'flex-start', textAlign: 'left', gap: 10, minHeight: 0, padding: 0, flexWrap: 'wrap' }}>
        <span style={{ color: METHOD_COLOR[method], fontWeight: 800, minWidth: 56 }}>{method.toUpperCase()}</span>
        <code style={{ wordBreak: 'break-all' }}>{path}</code>
        <span className={`pill${op['x-scope'] === 'control' ? ' warn' : ''}`}>{op['x-scope']}</span>
      </button>
      <span className="small">{op.summary}</span>
      {open && (
        <div className="stack" style={{ gap: 8 }}>
          {[...pathParams, ...query].length > 0 && (
            <table>
              <thead><tr><th>Parameter</th><th>In</th><th>About</th></tr></thead>
              <tbody>{[...pathParams, ...query].map((p) => <tr key={p.name}><td><code>{p.name}</code>{p.required ? ' *' : ''}</td><td>{p.in}</td><td>{p.description}</td></tr>)}</tbody>
            </table>
          )}
          {body && (
            <table>
              <thead><tr><th>Body field</th><th>About</th></tr></thead>
              <tbody>{Object.entries(body.properties).map(([k, v]) => <tr key={k}><td><code>{k}</code>{body.required.includes(k) ? ' *' : ''}</td><td>{v.description}</td></tr>)}</tbody>
            </table>
          )}
          <pre style={{ overflowX: 'auto', margin: 0, padding: 12, background: 'var(--surface-2)', borderRadius: 8, fontSize: '0.85rem' }}>{example}</pre>
        </div>
      )}
    </div>
  );
}

/** The API reference, built from /api/v1/openapi.json. Public, like the spec itself. */
export function ApiDocs() {
  const [spec] = useLoad<Spec>('/api/v1/openapi.json');
  const server = spec?.servers[0]?.url ?? '/api/v1';
  const ops = spec ? Object.entries(spec.paths).flatMap(([path, m]) => Object.entries(m).map(([method, op]) => ({ path, method, op }))) : [];
  const tags = [...new Set(ops.map((o) => o.op.tags[0]))];
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }} className="stack">
      <div className="row" style={{ gap: 12 }}>
        <RaccoonAvatar variant="ninja" size={56} />
        <div>
          <h1 style={{ margin: 0 }}>Den Duty API</h1>
          <p className="muted" style={{ margin: 0 }}>Version 1 · <a href="/api/v1/openapi.json">openapi.json</a></p>
        </div>
      </div>
      <section className="card stack">
        <p style={{ margin: 0 }}>
          Make a token in <strong>Settings → Home Assistant, automations and the API</strong>, then send it with every request as
          <code> Authorization: Bearer dnk_…</code>. A <strong>read</strong> token can call the GET endpoints; a <strong>control</strong> token can call all of them.
          Tokens belong to one home: put your Home ID (shown next to the tokens) in place of <code>{'{homeId}'}</code>.
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          Base address: <code>{server}</code>. Answers are JSON; errors are <code>{'{ "error": "…" }'}</code> with a 4xx status.
          Anything a token does is credited to it by name in the points history. Doctors, Helpdesk and AI features are not part of the API.
        </p>
      </section>
      {tags.map((t) => (
        <section key={t} className="stack">
          <h2 style={{ margin: '8px 0 0' }}>{t}</h2>
          {ops.filter((o) => o.op.tags[0] === t).map((o) => <Endpoint key={`${o.method} ${o.path}`} {...o} server={server} />)}
        </section>
      ))}
      <Link to="/" className="small">← Back to Den Duty</Link>
    </div>
  );
}
