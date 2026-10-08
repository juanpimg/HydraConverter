import { create } from 'zustand';
import { DEFAULT_OUTPUT_OPTIONS, type ConvertJob, type OutputOptions } from './types';

interface ConvertState {
  jobs: ConvertJob[];
  options: OutputOptions;
  addJob: (job: ConvertJob) => void;
  updateJob: (id: string, patch: Partial<ConvertJob>) => void;
  removeJob: (id: string) => void;
  clearJobs: () => void;
  setOptions: (patch: Partial<OutputOptions>) => void;
}

export const useConvertStore = create<ConvertState>((set) => ({
  jobs: [],
  options: DEFAULT_OUTPUT_OPTIONS,
  addJob: (job) => set((s) => ({ jobs: [...s.jobs, job] })),
  updateJob: (id, patch) =>
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
    })),
  removeJob: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
  clearJobs: () => set({ jobs: [] }),
  setOptions: (patch) => set((s) => ({ options: { ...s.options, ...patch } })),
}));
