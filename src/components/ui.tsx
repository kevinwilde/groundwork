import clsx from 'clsx';
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import type { ExerciseType, Tag } from '../db/types';
import { PALETTE } from '../lib/colors';
import { Icon, type IconName } from './Icon';

/** Inline style with CSS custom properties. */
export const vars = (v: Record<string, string | number | undefined>) => v as CSSProperties;

// ---------- buttons ----------
type ButtonKind = 'primary' | 'ghost' | 'danger' | 'danger-text' | 'on-plate' | 'default';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: ButtonKind;
  size?: 'sm' | 'md';
  icon?: IconName;
}

export function Button({ kind = 'default', size = 'md', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={clsx('btn', kind !== 'default' && kind, size === 'sm' && 'sm', className)} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children != null && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon, label, size = 18, className, ...rest }: { icon: IconName; label: string; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={clsx('icon-btn', className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

// ---------- chips ----------
interface ChipProps {
  label: ReactNode;
  color?: string;
  on?: boolean;
  small?: boolean;
  count?: number;
  title?: string;
  className?: string;
  onClick?: () => void;
}

export function Chip({ label, color, on, small, count, title, className, onClick }: ChipProps) {
  const cls = clsx('chip', on && 'on', small && 'sm', onClick && 'clickable', className);
  const style = color ? vars({ '--c': color }) : undefined;
  const inner = (
    <>
      {color && <i className="chip-dot" aria-hidden="true" />}
      <span className="chip-label">{label}</span>
      {count != null && <span className="chip-count">{count}</span>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} style={style} title={title} aria-pressed={!!on} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return (
    <span className={cls} style={style} title={title}>
      {inner}
    </span>
  );
}

export function TagChips({ tags, className }: { tags: Tag[]; className?: string }) {
  if (!tags.length) return null;
  return (
    <span className={clsx('chips', className)}>
      {tags.map((t) => (
        <Chip key={t.id} label={t.name} color={t.color} small />
      ))}
    </span>
  );
}

export function TypePill({ type }: { type: ExerciseType }) {
  return (
    <span className="type-pill" style={vars({ '--c': type.color })}>
      {type.name}
    </span>
  );
}

export function Badge({ children, kind }: { children: ReactNode; kind?: 'sample' | 'warn' }) {
  return <span className={clsx('badge', kind)}>{children}</span>;
}

// ---------- segmented control ----------
export interface SegOption<T> {
  value: T;
  label: ReactNode;
  title?: string;
  color?: string;
}

interface SegmentedProps<T> {
  options: SegOption<T>[];
  value: T | null;
  onChange: (v: T | null) => void;
  /** Clicking the selected option clears it. */
  toggle?: boolean;
  label?: string;
  className?: string;
}

export function Segmented<T extends string | number>({ options, value, onChange, toggle, label, className }: SegmentedProps<T>) {
  return (
    <div className={clsx('seg', className)} role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            className={clsx('seg-btn', on && 'on')}
            aria-pressed={on}
            title={o.title}
            style={o.color ? vars({ '--c': o.color }) : undefined}
            onClick={() => onChange(toggle && on ? null : o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- form bits ----------
interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  optional?: boolean;
  hint?: ReactNode;
  className?: string;
  /** Render as a div (for groups of controls) instead of a label. */
  group?: boolean;
  htmlFor?: string;
}

export function Field({ label, children, optional, hint, className, group, htmlFor }: FieldProps) {
  const body = (
    <>
      <span className="field-label">
        {label}
        {optional && <span className="field-opt"> optional</span>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </>
  );
  if (group) return <div className={clsx('field', className)} role="group">{body}</div>;
  return (
    <label className={clsx('field', className)} htmlFor={htmlFor}>
      {body}
    </label>
  );
}

export function Switch({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="switch" htmlFor={id}>
      <input id={id} type="checkbox" className="switch-input" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      {label != null && <span className="switch-label">{label}</span>}
    </label>
  );
}

export function Swatches({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Colour">
      {PALETTE.map((p) => (
        <button
          key={p.hex}
          type="button"
          role="radio"
          aria-checked={p.hex === value}
          aria-label={p.name}
          title={p.name}
          className={clsx('swatch', p.hex === value && 'on')}
          style={vars({ '--c': p.hex })}
          onClick={() => onChange(p.hex)}
        />
      ))}
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="form-error" role="alert">
      {children}
    </div>
  );
}

// ---------- layout ----------
export function PageHead({ title, eyebrow, actions }: { title: string; eyebrow?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function SectionHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 className="section-title">{title}</h2>
      {children && <div className="section-actions">{children}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <p className="empty-body">{children}</p>}
      {action}
    </div>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <i className={clsx('dot', className)} style={vars({ '--c': color })} aria-hidden="true" />;
}
