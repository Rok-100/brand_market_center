--
-- PostgreSQL database dump
--

-- Dumped from database version 16.6 (Debian 16.6-1.pgdg120+1)
-- Dumped by pg_dump version 16.6 (Debian 16.6-1.pgdg120+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_video_credit_daily_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_video_credit_daily_snapshot (
    data_date date NOT NULL,
    platform character varying(16) NOT NULL,
    daily_credits numeric,
    cumulative_credits numeric,
    balance_credits numeric,
    reported_accounts integer DEFAULT 0 NOT NULL,
    tracked_accounts integer DEFAULT 0 NOT NULL,
    status character varying(24) NOT NULL,
    source character varying(32) NOT NULL,
    source_revision integer,
    source_note text,
    collected_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ai_video_credit_daily_platform_check CHECK (((platform)::text = ANY (ARRAY[('kling'::character varying)::text, ('libtv'::character varying)::text]))),
    CONSTRAINT ai_video_credit_daily_status_check CHECK (((status)::text = ANY (ARRAY[('available'::character varying)::text, ('partial'::character varying)::text, ('unavailable'::character varying)::text])))
);


--
-- Name: performance_fluctuation_reason; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.performance_fluctuation_reason (
    data_date date NOT NULL,
    channel character varying(16) NOT NULL,
    status character varying(24) NOT NULL,
    summary text,
    source_name character varying(128) DEFAULT 'WIS项目数据群'::character varying NOT NULL,
    source_chat_id character varying(128) NOT NULL,
    source_message_ids text DEFAULT '[]'::text NOT NULL,
    source_latest_at timestamp with time zone,
    aggregated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT performance_fluctuation_reason_channel_check CHECK (((channel)::text = ANY (ARRAY[('douyin'::character varying)::text, ('wechat'::character varying)::text]))),
    CONSTRAINT performance_fluctuation_reason_status_check CHECK (((status)::text = ANY (ARRAY[('available'::character varying)::text, ('not_mentioned'::character varying)::text])))
);


--
-- Name: ai_video_credit_daily_snapshot ai_video_credit_daily_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_video_credit_daily_snapshot
    ADD CONSTRAINT ai_video_credit_daily_snapshot_pkey PRIMARY KEY (data_date, platform);


--
-- Name: performance_fluctuation_reason performance_fluctuation_reason_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performance_fluctuation_reason
    ADD CONSTRAINT performance_fluctuation_reason_pkey PRIMARY KEY (data_date, channel);


--
-- Name: idx_ai_video_credit_daily_collected_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_video_credit_daily_collected_at ON public.ai_video_credit_daily_snapshot USING btree (collected_at DESC);


--
-- Name: idx_performance_fluctuation_reason_aggregated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_performance_fluctuation_reason_aggregated_at ON public.performance_fluctuation_reason USING btree (aggregated_at DESC);


--
-- PostgreSQL database dump complete
--

