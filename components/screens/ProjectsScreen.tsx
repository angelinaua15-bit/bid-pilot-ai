'use client';

import { useEffect, useState } from 'react';
import { Search, SlidersHorizontal, RefreshCw, X } from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { ProjectCard } from '@/components/shared/ProjectCard';
import { LoadingState } from '@/components/shared/LoadingState';
import { EmptyState } from '@/components/shared/EmptyState';
import type { Project, NavTab } from '@/types';
import { cn } from '@/lib/utils';
import { safeText } from '@/lib/safe-text';

const CATEGORIES = ['All', 'Telegram bots', 'AI agents', 'Websites', 'Automation', 'E-commerce'];

interface ProjectsScreenProps {
  onNavigate: (tab: NavTab) => void;
}

export function ProjectsScreen({ onNavigate }: ProjectsScreenProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [onlyNew, setOnlyNew] = useState(false);

  const load = async (showSyncSpinner = false) => {
    if (showSyncSpinner) setSyncing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/projects').then((r) => r.json());
      if (res.ok) setProjects(res.data);
      else setError(res.error ?? 'Failed to load projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSync = () => {
    haptic.medium();
    load(true);
    haptic.success();
  };

  const CATEGORY_MAP: Record<string, string[]> = {
    'Telegram bots': ['telegram', 'bot', 'бот'],
    'AI agents':     ['ai', 'gpt', 'openai', 'штучний', 'llm'],
    'Websites':      ['сайт', 'web', 'landing', 'react', 'next'],
    'Automation':    ['автоматиз', 'parse', 'скрипт', 'n8n', 'zapier'],
    'E-commerce':    ['магазин', 'ecommerce', 'shopify', 'woo'],
  };

  const filtered = projects.filter((p) => {
    const title       = safeText(p.title);
    const description = safeText(p.description);
    const category    = safeText(p.category);
    const q           = search.toLowerCase();

    const matchSearch =
      !search ||
      title.includes(q) ||
      description.includes(q) ||
      category.includes(q);

    const matchCat =
      activeCategory === 'All' ||
      (CATEGORY_MAP[activeCategory] ?? []).some((kw) =>
        `${title} ${description} ${category}`.includes(kw.toLowerCase())
      );

    const matchNew = !onlyNew || p.isNew;
    return matchSearch && matchCat && matchNew;
  });

  return (
    <div className="flex flex-col h-dvh">
      {/* Search bar */}
      <div className="px-4 pt-4 pb-3 flex gap-2">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="tg-input pl-9 pr-4"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground"
        >
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filters row */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <div className="flex-1 flex gap-2 overflow-x-auto scrollbar-none pb-0.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => { haptic.select(); setActiveCategory(cat); }}
              className={cn(
                'flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all',
                activeCategory === cat
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground'
              )}
            >
              {cat}
            </button>
          ))}
        </div>
        <button
          onClick={() => { haptic.select(); setOnlyNew((v) => !v); }}
          className={cn(
            'flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-all',
            onlyNew ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-secondary text-muted-foreground'
          )}
        >
          <SlidersHorizontal size={12} />
          Нові
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-nav">
        {loading ? (
          <LoadingState rows={3} />
        ) : error ? (
          <EmptyState
            icon={<Search size={24} />}
            title="Could not load projects"
            description={error}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search size={24} />}
            title="No projects found"
            description="Try adjusting filters or sync"
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground py-1">
              {filtered.length} project{filtered.length !== 1 ? 's' : ''} found
            </p>
            {filtered.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onGenerate={() => onNavigate('history')}
                onSkip={(p) => setProjects((prev) => prev.filter((x) => x.id !== p.id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
