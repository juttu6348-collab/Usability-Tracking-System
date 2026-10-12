'use strict';
// Page-view cohorts prevent duplicate scroll notifications and duration checkpoints
// from inflating averages. Session + URL + view ID identify a view within a project.
const views = `WITH views AS (
  SELECT session_id, page_url, page_path,
    coalesce(json_extract(payload,'$.page_view_id'),event_id) view_id,
    min(timestamp) started_at
  FROM events WHERE project_id=? AND event_type='page_view'
  GROUP BY session_id,page_url,page_path,view_id
), metrics AS (
  SELECT v.*, coalesce(max(CASE WHEN e.event_type='scroll_depth' THEN json_extract(e.payload,'$.scroll_percentage') END),0) depth,
    coalesce(sum(CASE WHEN e.event_type='page_active' THEN json_extract(e.payload,'$.duration_ms') ELSE 0 END),0) active_ms
  FROM views v LEFT JOIN events e ON e.project_id=? AND e.session_id=v.session_id AND e.page_url=v.page_url
    AND json_extract(e.payload,'$.page_view_id')=v.view_id AND e.event_type IN ('scroll_depth','page_active')
  GROUP BY v.session_id,v.page_url,v.page_path,v.view_id
)`;
const interactions = "('click','focus','form_interaction','form_submit')";
function dashboard(db, project) {
  const overview = db.prepare(`${views} SELECT count(*) measured_page_views, coalesce(avg(depth),0) average_scroll_depth,
    sum(depth>=25) reach25, sum(depth>=50) reach50, sum(depth>=75) reach75, sum(depth>=100) reach100 FROM metrics`).get(project, project);
  const sessions = db.prepare('SELECT count(*) total_sessions, coalesce(avg(active_duration_ms),0) average_session_duration_ms FROM sessions WHERE project_id=?').get(project);
  const pages = db.prepare(`${views} SELECT page_url,page_path,count(*) views,count(DISTINCT session_id) sessions,avg(active_ms) average_active_ms FROM metrics GROUP BY page_url,page_path ORDER BY views DESC,page_url LIMIT 500`).all(project, project);
  const recent = db.prepare(`SELECT s.session_id,s.first_seen,s.last_seen,s.active_duration_ms,
    (SELECT page_path FROM events e WHERE e.project_id=s.project_id AND e.session_id=s.session_id AND event_type='page_view' ORDER BY timestamp,id LIMIT 1) first_page,
    (SELECT count(*) FROM events e WHERE e.project_id=s.project_id AND e.session_id=s.session_id AND event_type='page_view') pages_visited,
    (SELECT count(*) FROM events e WHERE e.project_id=s.project_id AND e.session_id=s.session_id AND event_type IN ${interactions}) interactions
    FROM sessions s WHERE project_id=? ORDER BY last_seen DESC,session_id LIMIT 50`).all(project);
  return { ...sessions,
    total_events: db.prepare('SELECT count(*) n FROM events WHERE project_id=?').get(project).n,
    total_interactions: db.prepare(`SELECT count(*) n FROM events WHERE project_id=? AND event_type IN ${interactions}`).get(project).n,
    total_page_views: db.prepare("SELECT count(*) n FROM events WHERE project_id=? AND event_type='page_view'").get(project).n,
    average_scroll_depth: overview.average_scroll_depth, measured_page_views: overview.measured_page_views,
    pages, recent_sessions: recent,
    top_interactions: db.prepare(`SELECT page_path,json_extract(payload,'$.element.selector') selector,
      json_extract(payload,'$.element.tag') tag,json_extract(payload,'$.element.label') label,event_type,count(*) count
      FROM events WHERE project_id=? AND event_type IN ${interactions} GROUP BY page_path,selector,tag,label,event_type ORDER BY count DESC,page_path,selector,event_type LIMIT 50`).all(project),
    attention: db.prepare(`SELECT page_path,json_extract(payload,'$.element.selector') selector,sum(json_extract(payload,'$.duration_ms')) duration_ms,
      avg(json_extract(payload,'$.duration_ms')) average_duration_ms,count(*) observations,
      count(DISTINCT session_id) sessions FROM events WHERE project_id=? AND event_type='element_attention'
      GROUP BY page_path,selector ORDER BY duration_ms DESC,page_path,selector LIMIT 20`).all(project),
    scroll: [25,50,75,100].map(depth => ({ depth, page_views: overview['reach' + depth] || 0,
      percentage: overview.measured_page_views ? (overview['reach' + depth] || 0) / overview.measured_page_views * 100 : 0 })) };
}
module.exports = { dashboard };
