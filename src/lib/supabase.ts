/**
 * Supabase 클라이언트 유틸리티
 * Cloudflare Workers 환경에서 Supabase PostgreSQL 연결
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * 데이터베이스 타입 정의
 */
export type Database = {
  public: {
    Tables: {
      analyses: {
        Row: {
          id: number;
          video_id: string;
          url: string;
          transcript: string | null;
          summary: string | null;
          created_at: string;
          channel_id: string | null;
          channel_name: string | null;
          title: string | null;
          upload_date: string | null;
          status: string;
          source: string;
        };
        Insert: {
          video_id: string;
          url: string;
          transcript?: string | null;
          summary?: string | null;
          channel_id?: string | null;
          channel_name?: string | null;
          title?: string | null;
          upload_date?: string | null;
          status?: string;
          source?: string;
        };
        Update: {
          video_id?: string;
          url?: string;
          transcript?: string | null;
          summary?: string | null;
          channel_id?: string | null;
          channel_name?: string | null;
          title?: string | null;
          upload_date?: string | null;
          status?: string;
          source?: string;
        };
      };
      batch_jobs: {
        Row: {
          id: number;
          channel_id: string;
          channel_name: string | null;
          total_videos: number;
          completed_videos: number;
          failed_videos: number;
          status: string;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          channel_id: string;
          channel_name?: string | null;
          total_videos?: number;
          completed_videos?: number;
          failed_videos?: number;
          status?: string;
          completed_at?: string | null;
        };
        Update: {
          channel_id?: string;
          channel_name?: string | null;
          total_videos?: number;
          completed_videos?: number;
          failed_videos?: number;
          status?: string;
          completed_at?: string | null;
        };
      };
      batch_videos: {
        Row: {
          id: number;
          batch_id: number;
          video_id: string;
          video_title: string | null;
          video_url: string | null;
          analysis_id: number | null;
          status: string;
          error_message: string | null;
          upload_date: string | null;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
          current_step: string;
        };
        Insert: {
          batch_id: number;
          video_id: string;
          video_title?: string | null;
          video_url?: string | null;
          analysis_id?: number | null;
          status?: string;
          error_message?: string | null;
          upload_date?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          current_step?: string;
        };
        Update: {
          batch_id?: number;
          video_id?: string;
          video_title?: string | null;
          video_url?: string | null;
          analysis_id?: number | null;
          status?: string;
          error_message?: string | null;
          upload_date?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          current_step?: string;
        };
      };
      export_history: {
        Row: {
          id: number;
          export_type: string;
          format: string;
          file_size: number | null;
          analysis_count: number | null;
          created_at: string;
        };
        Insert: {
          export_type: string;
          format: string;
          file_size?: number | null;
          analysis_count?: number | null;
        };
        Update: {
          export_type?: string;
          format?: string;
          file_size?: number | null;
          analysis_count?: number | null;
        };
      };
    };
  };
};

/**
 * Supabase 클라이언트 생성
 * 
 * @param supabaseUrl - Supabase Project URL
 * @param supabaseKey - Supabase Service Role Key (서버용)
 * @returns Supabase 클라이언트 인스턴스
 */
export function createSupabaseClient(
  supabaseUrl: string,
  supabaseKey: string
): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, supabaseKey, {
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

export type ExportHistory = Database['public']['Tables']['export_history']['Row'];
export type ExportHistoryInsert = Database['public']['Tables']['export_history']['Insert'];
