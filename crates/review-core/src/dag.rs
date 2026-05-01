use std::collections::HashMap;

use crate::types::{CommitInfo, DagEdge};

/// Minimal commit metadata required to lay out the DAG. Both the local
/// (git2-rs) and remote (git CLI parsing) backends build a `Vec<RawCommit>`
/// in newest-first topological order and hand it to [`assemble_commits`].
#[derive(Debug, Clone)]
pub struct RawCommit {
    pub oid: String,
    pub parent_oids: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub summary: String,
    pub branches: Vec<String>,
    pub is_head: bool,
}

/// Assign each commit a lane + edges and return [`CommitInfo`] records.
/// Straight-branch variant: first-parent stays in-lane, merge parents take
/// new lanes, lanes are freed when the commit at that lane is visited.
pub fn assemble_commits(raw: &[RawCommit]) -> Vec<CommitInfo> {
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut oid_to_lane: HashMap<String, usize> = HashMap::new();
    let mut oid_to_color: HashMap<String, usize> = HashMap::new();
    let mut next_color: usize = 0;
    let mut out = Vec::with_capacity(raw.len());

    for r in raw {
        let my_lane = if let Some(&lane) = oid_to_lane.get(&r.oid) {
            lane
        } else {
            let lane = lanes
                .iter()
                .position(|l| l.is_none())
                .unwrap_or_else(|| {
                    lanes.push(None);
                    lanes.len() - 1
                });
            lanes[lane] = Some(r.oid.clone());
            oid_to_color.insert(r.oid.clone(), next_color);
            next_color += 1;
            lane
        };

        let my_color = *oid_to_color.get(&r.oid).unwrap_or(&0);
        let mut edges = Vec::new();
        lanes[my_lane] = None;

        for (i, parent_oid) in r.parent_oids.iter().enumerate() {
            let parent_lane = if let Some(&existing) = oid_to_lane.get(parent_oid) {
                existing
            } else if i == 0 {
                lanes[my_lane] = Some(parent_oid.clone());
                oid_to_lane.insert(parent_oid.clone(), my_lane);
                oid_to_color.insert(parent_oid.clone(), my_color);
                my_lane
            } else {
                let lane = lanes
                    .iter()
                    .position(|l| l.is_none())
                    .unwrap_or_else(|| {
                        lanes.push(None);
                        lanes.len() - 1
                    });
                lanes[lane] = Some(parent_oid.clone());
                oid_to_lane.insert(parent_oid.clone(), lane);
                let color = next_color;
                next_color += 1;
                oid_to_color.insert(parent_oid.clone(), color);
                lane
            };

            let edge_color = if i == 0 {
                my_color
            } else {
                *oid_to_color.get(parent_oid).unwrap_or(&0)
            };

            edges.push(DagEdge {
                from_lane: my_lane,
                to_lane: parent_lane,
                color: edge_color,
            });
        }

        // Capture lane_count BEFORE popping trailing Nones, so the row's
        // visual width covers this commit's own lane and any edge endpoints
        // even when the lane is freed (e.g., a sibling branch tip whose
        // parent is already on a lower active lane).
        let lane_count = lanes.len().max(my_lane + 1);

        while lanes.last() == Some(&None) {
            lanes.pop();
        }

        let short_oid = r.oid[..7.min(r.oid.len())].to_string();
        out.push(CommitInfo {
            oid: r.oid.clone(),
            short_oid,
            parent_oids: r.parent_oids.clone(),
            author_name: r.author_name.clone(),
            author_email: r.author_email.clone(),
            timestamp: r.timestamp,
            summary: r.summary.clone(),
            branches: r.branches.clone(),
            tags: Vec::new(),
            is_head: r.is_head,
            lane: my_lane,
            edges,
            lane_count,
        });
    }

    out
}
