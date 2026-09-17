import type {IconName} from "@blueprintjs/icons";
import {MaybeElement} from "@blueprintjs/core/src/common/props.ts";
import {Icon} from "@blueprintjs/core";
import React from "react";

// `clip` and not `hidden`: a hidden box is a scroll container, and Chrome reserves a scrollbar width
// inside it, which opens a hole in the middle of the path.
const clip: React.CSSProperties = {minWidth: 0, overflow: "clip"}

/**
 * One line, at every panel width. The end of the title names the thing, so the folder in front of it
 * is dimmed and gives up its width a hundred times faster. The whole title stays in the tooltip.
 */
export function InsSectionTitle({title, icon}: { title: string, icon?: IconName | MaybeElement }) {
    const nameAt = title.lastIndexOf('/') + 1
    return <div className={"xPaddedContent folderContent folder-trigger-text"}
                title={title}
                style={{
                    marginLeft: 0,
                    color: "var(--pt-text-color)",
                    flex: "1 1 auto",
                    minWidth: 0,
                    textAlign: "left",
                    gap: "var(--pt-grid-size)",
                    display: "flex",
                    alignItems: "center",
                    whiteSpace: "nowrap",

                }}
    >
        {icon && (typeof icon === 'string' ? <Icon icon={icon} style={{flex: "0 0 auto"}} size={12}/> : icon)}

        {/* One flex item, so the row's gap never opens inside a path. */}
        <span style={{display: "flex", flex: "1 1 auto", ...clip}}>
            {nameAt > 0 && <span style={{...clip, flexShrink: 100, textOverflow: "ellipsis", color: "var(--pt-text-color-muted)"}}>
                {title.slice(0, nameAt)}
            </span>}
            <span style={{...clip, flexShrink: 1, textOverflow: "ellipsis"}}>{title.slice(nameAt)}</span>
        </span>
    </div>;
}
