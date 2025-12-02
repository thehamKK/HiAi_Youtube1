/**
 * Supabase 클라이언트 유틸리티
 * Cloudflare Workers 환경에서 Supabase PostgreSQL 연결
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * 데이터베이스 타입 정의 (실제 SQL 스키마 기반)
 */
export type Database = {
  public: {
    Tables: {
      analyses: {
        Row: {
          id: number;
          video_id: string;
          channel_id: string | null;
          title: string;
          url: string;
          summary: string | null;
          transcript: string | null;
          status: 'pending' | 'processing' | 'completed' | 'failed' | 'transcript_only';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          video_id: string;
          channel_id?: string | null;
          title: string;
          url: string;
          summary?: string | null;
          transcript?: string | null;
          status?: 'pending' | 'processing' | 'completed' | 'failed' | 'transcript_only';
        };
        Update: {
          video_id?: string;
          channel_id?: string | null;
          title?: string;
          url?: string;
          summary?: string | null;
          transcript?: string | null;
          status?: 'pending' | 'processing' | 'completed' | 'failed' | 'transcript_only';
        };
      };
      batch_jobs: {
        Row: {
          id: number;
          channel_id: string;
          channel_name: string;
          total_videos: number;
          processed_videos: number;
          status: 'pending' | 'processing' | 'completed' | 'failed';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          channel_id: string;
          channel_name: string;
          total_videos?: number;
          processed_videos?: number;
          status?: 'pending' | 'processing' | 'completed' | 'failed';
        };
        Update: {
          channel_id?: string;
          channel_name?: string;
          total_videos?: number;
          processed_videos?: number;
          status?: 'pending' | 'processing' | 'completed' | 'failed';
        };
      };
      batch_videos: {
        Row: {
          id: number;
          batch_id: number;
          video_id: string;
          title: string;
          url: string;
          status: 'pending' | 'processing' | 'completed' | 'failed' | 'transcript_only';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          batch_id: number;
          video_id: string;
          title: string;
          url: string;
          status?: 'pending' | 'processing' | 'completed' | 'failed' | 'transcript_only';
        };
        Update: {
          batch_id?: number;
          video_id?: string;
          title?: string;
          url?: string;
          status?: 'pending' | 'processing' | 'completed' | 'failed' | 'transcript_only';
        };
      };
      download_history: {
        Row: {
          id: number;
          download_type: 'full' | 'selected';
          video_ids: string[];
          downloaded_at: string;
        };
        Insert: {
          download_type: 'full' | 'selected';
          video_ids: string[];
        };
        Update: {
          download_type?: 'full' | 'selected';
          video_ids?: string[];
        };
      };
    };
  };
};

/**
 * Bindings 타입 정의 (Supabase 키 추가)
 */
export type Bindings = {
  DB?: D1Database; // D1은 마이그레이션 완료 후 제거
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  YOUTUBE_API_KEY: string;
  GEMINI_API_KEY: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
};

/**
 * Supabase 클라이언트 생성 (Hono Context에서 호출)
 * 
 * @param env - Cloudflare Workers Bindings (환경 변수)
 * @returns Supabase 클라이언트 인스턴스
 */
export function createSupabaseClient(env: Bindings): SupabaseClient<Database> {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false, // Cloudflare Workers에서는 세션 저장 불필요
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'x-client-info': 'hidb-cloudflare-workers',
      },
    },
  });
}

/**
 * Supabase 타입 헬퍼
 */
export type Analysis = Database['public']['Tables']['analyses']['Row'];
export type AnalysisInsert = Database['public']['Tables']['analyses']['Insert'];
export type AnalysisUpdate = Database['public']['Tables']['analyses']['Update'];

export type BatchJob = Database['public']['Tables']['batch_jobs']['Row'];
export type BatchJobInsert = Database['public']['Tables']['batch_jobs']['Insert'];
export type BatchJobUpdate = Database['public']['Tables']['batch_jobs']['Update'];

export type BatchVideo = Database['public']['Tables']['batch_videos']['Row'];
export type BatchVideoInsert = Database['public']['Tables']['batch_videos']['Insert'];
export type BatchVideoUpdate = Database['public']['Tables']['batch_videos']['Update'];

export type DownloadHistory = Database['public']['Tables']['download_history']['Row'];
export type DownloadHistoryInsert = Database['public']['Tables']['download_history']['Insert'];
export type DownloadHistoryUpdate = Database['public']['Tables']['download_history']['Update'];
