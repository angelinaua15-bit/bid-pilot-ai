'use client';

import { ExternalLink, Star, Clock, Users } from 'lucide-react';
import { haptic, openExternalLink } from '@/lib/telegram';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';

interface ProjectCardProps {
  project: Project;
  onGenerate?: (project: Project) => void;
  onSkip?: (project: Project) => void;
  compact?: boolean;
}

export function ProjectCard({ project, onGenerate, onSkip, compact }: ProjectCardProps) {
  const score = project.matchScore ?? 0;
  const scoreColor =
    score >= 90 ? 'text-green-400 bg-green-400/10' :
    score >= 75 ? 'text-yellow-400 bg-yellow-400/10' :
    'text-muted-foreground bg-secondary';

  return (
    <div className={cn('glass-card rounded-2xl p-4 flex flex-col gap-3', project.isNew && 'border-primary/30')}>
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {project.isNew && (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                Новий
              </span>
            )}
            <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
              {project.category}
            </span>
          </div>
          <h3 className="text-sm font-semibold leading-snug text-balance">{project.title}</h3>
        </div>
        {score > 0 && (
          <div className={cn('flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-xl', scoreColor)}>
            {score}%
          </div>
        )}
      </div>

      {/* Description */}
      {!compact && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
          {project.description}
        </p>
      )}

      {/* Meta */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span className="font-semibold text-foreground">
          ${project.budget}{project.budgetMax ? `–$${project.budgetMax}` : ''}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={11} />
          {formatDistanceToNow(new Date(project.publishedAt), { addSuffix: true, locale: uk })}
        </span>
        <span className="flex items-center gap-1">
          <Users size={11} />
          {project.bidsCount} заявок
        </span>
        {project.clientRating && (
          <span className="flex items-center gap-1">
            <Star size={11} className="text-yellow-400 fill-yellow-400" />
            {project.clientRating}
          </span>
        )}
      </div>

      {/* Tags */}
      {!compact && project.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {project.skills.slice(0, 4).map((s) => (
            <span key={s} className="text-[11px] bg-secondary text-muted-foreground px-2.5 py-0.5 rounded-lg">
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => { haptic.medium(); onGenerate?.(project); }}
          className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold transition-all active:scale-95"
        >
          Згенерувати заявку
        </button>
        <button
          onClick={() => { haptic.light(); openExternalLink(project.projectUrl); }}
          className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground transition-all active:scale-95"
        >
          <ExternalLink size={15} />
        </button>
        {onSkip && (
          <button
            onClick={() => { haptic.light(); onSkip(project); }}
            className="px-3 py-2.5 rounded-xl bg-secondary text-muted-foreground text-xs font-medium transition-all active:scale-95"
          >
            Пропустити
          </button>
        )}
      </div>
    </div>
  );
}
