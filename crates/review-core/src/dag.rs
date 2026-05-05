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
            let lane = lanes.iter().position(|l| l.is_none()).unwrap_or_else(|| {
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
                let lane = lanes.iter().position(|l| l.is_none()).unwrap_or_else(|| {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(oid: &str, parents: &[&str], is_head: bool) -> RawCommit {
        RawCommit {
            oid: oid.to_string(),
            parent_oids: parents.iter().map(|s| s.to_string()).collect(),
            author_name: "Test".to_string(),
            author_email: "test@test.com".to_string(),
            timestamp: 0,
            summary: format!("commit {oid}"),
            branches: Vec::new(),
            is_head,
        }
    }

    #[test]
    fn linear_chain() {
        // C -> B -> A (newest first)
        let commits = vec![
            raw("C", &["B"], true),
            raw("B", &["A"], false),
            raw("A", &[], false),
        ];
        let result = assemble_commits(&commits);
        assert_eq!(result.len(), 3);
        for c in &result {
            assert_eq!(c.lane, 0, "linear chain should all be in lane 0");
        }
        assert_eq!(result[0].edges.len(), 1);
        assert_eq!(result[0].edges[0].from_lane, 0);
        assert_eq!(result[0].edges[0].to_lane, 0);
    }

    #[test]
    fn root_commit_has_no_edges() {
        let commits = vec![raw("A", &[], true)];
        let result = assemble_commits(&commits);
        assert_eq!(result.len(), 1);
        assert!(result[0].edges.is_empty());
        assert_eq!(result[0].lane, 0);
    }

    #[test]
    fn fork_uses_two_lanes() {
        // D -> B (main), C -> A (branch), B -> A
        // Topological: D, C, B, A
        let commits = vec![
            raw("D", &["B"], true),
            raw("C", &["A"], false),
            raw("B", &["A"], false),
            raw("A", &[], false),
        ];
        let result = assemble_commits(&commits);
        assert_eq!(result.len(), 4);
        // D is in lane 0
        assert_eq!(result[0].lane, 0);
        // C takes a different lane since lane 0 is occupied by B
        assert_ne!(result[0].lane, result[1].lane);
    }

    #[test]
    fn merge_commit_has_two_edges() {
        // M -> B, M -> C (merge), B -> A, C -> A
        // Topological: M, C, B, A
        let commits = vec![
            raw("M", &["B", "C"], true),
            raw("C", &["A"], false),
            raw("B", &["A"], false),
            raw("A", &[], false),
        ];
        let result = assemble_commits(&commits);
        let merge = &result[0];
        assert_eq!(merge.oid, "M");
        assert_eq!(merge.edges.len(), 2);
        assert_eq!(merge.edges[0].from_lane, merge.lane);
        assert_eq!(merge.edges[1].from_lane, merge.lane);
        // First parent stays in-lane, second gets a new lane
        assert_ne!(merge.edges[0].to_lane, merge.edges[1].to_lane);
    }

    #[test]
    fn short_oid_is_seven_chars() {
        let commits = vec![raw("abcdef1234567890", &[], true)];
        let result = assemble_commits(&commits);
        assert_eq!(result[0].short_oid, "abcdef1");
    }

    #[test]
    fn short_oid_for_short_input() {
        let commits = vec![raw("abc", &[], true)];
        let result = assemble_commits(&commits);
        assert_eq!(result[0].short_oid, "abc");
    }

    #[test]
    fn lane_count_covers_active_lanes() {
        // With a fork, lane_count should be >= 2 for some rows
        let commits = vec![
            raw("D", &["B"], true),
            raw("C", &["A"], false),
            raw("B", &["A"], false),
            raw("A", &[], false),
        ];
        let result = assemble_commits(&commits);
        let max_lane_count = result.iter().map(|c| c.lane_count).max().unwrap();
        assert!(max_lane_count >= 2);
    }

    #[test]
    fn first_parent_inherits_color() {
        let commits = vec![raw("B", &["A"], true), raw("A", &[], false)];
        let result = assemble_commits(&commits);
        assert_eq!(result[0].edges[0].color, 0);
    }
}
