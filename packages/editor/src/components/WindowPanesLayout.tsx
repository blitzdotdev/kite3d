import {ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle} from "react-resizable-panels";
import {CSSProperties, ReactNode, useEffect, useRef, useState} from "react";
import {Card, Tab, Tabs} from "@blueprintjs/core";
import {toTitleCase} from "threepipe";
import {EditPreviewButtonGroup} from "./EditPreviewButtonGroup.tsx";
import {InteractionControlsButtonGroup} from "./InteractionControlsButtonGroup.tsx";
import {WindowPanelFlap} from "./WindowPanelFlap.tsx";
import {PopupDialogCard} from "./PopupDialogCard.tsx";

export interface WindowPanel{
    /** A string is title cased; a node is drawn as it is, which is how a document tab carries its icon. */
    title: ReactNode
    content: ReactNode
    style?: CSSProperties
    key?: string
    className?: string
    disabled?: boolean
}
export interface WindowPanesLayoutProps{
    panels: {
        left: (WindowPanel|null)[]
        right: (WindowPanel|null)[]
        bottom: null | (WindowPanel|null)[]
        center: (WindowPanel|null)[]
    }
    /** The centre tab to show. The bottom and right slots keep their own selection. */
    selectedCenterTabId?: string
    onCenterTabChange?: (id: string)=>void
    /** The left tab to show. A reference row in the Objects tree switches it to Resources. */
    selectedLeftTabId?: string
    onLeftTabChange?: (id: string)=>void
}

export function WindowPanesLayout({ panels, selectedCenterTabId, onCenterTabChange, selectedLeftTabId, onLeftTabChange }: WindowPanesLayoutProps){
    const panelRefs = {
        left: useRef<ImperativePanelHandle>(null),
        right: useRef<ImperativePanelHandle>(null),
        bottom: useRef<ImperativePanelHandle>(null),
    };

    const [isExpanded, setIsExpanded] = useState(false);
    const [, forceUpdate] = useState(0);

    const triggerUpdate = () => forceUpdate(prev => prev + 1);

    const togglePanel = (position: 'left' | 'right' | 'bottom') => {
        const panel = panelRefs[position].current;
        if (panel?.isCollapsed()) {
            panel.expand();
        } else {
            panel?.collapse();
        }
    };

    const toggleExpand = () => {
        if (isExpanded) {
            // Restore panels
            panelRefs.left.current?.expand();
            panelRefs.right.current?.expand();
            panelRefs.bottom.current?.expand();
        } else {
            // Collapse all panels
            panelRefs.left.current?.collapse();
            panelRefs.right.current?.collapse();
            panelRefs.bottom.current?.collapse();
        }
        setIsExpanded(!isExpanded);
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement
            if(target&&['INPUT','TEXTAREA','SELECT'].includes(target.tagName)) return
            if (event.shiftKey && event.code === 'Space') {
                event.preventDefault();
                toggleExpand();
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [isExpanded]);

    const renderPanel  = (panel: WindowPanel, index: number)=> {
        return <Card key={panel.key ?? index} style={panel.style} className={"window-panel-card"}>
            {/*<div style={{fontWeight: 'bold', marginBottom: '4px'}}>{panel.title}</div>*/}
            {/*<div></div>*/}
            {panel.content}
        </Card>
    }

    const renderPanels  = (p0: (WindowPanel|null)[], vertical = false, controlled?: {selectedTabId?: string, onChange?: (id: string)=>void})=> {
        const p = p0.filter(p=>!!p)
        if(!p.length) return
        // One panel gets a strip too: the center slot is the document tabs, and one open document
        // still needs its tab.
        return <Tabs
            vertical={vertical}
            animate={false}
            renderActiveTabPanelOnly={true}
            size={"medium"}
            className={"window-panels-tabs"}
            selectedTabId={controlled?.selectedTabId}
            onChange={controlled?.onChange ? (id)=>controlled.onChange!(String(id)) : undefined}
        >
            {p.map(({className, ...panel}, i)=>(
                <Tab id={panel.key || `tab-${i}`} key={panel.key || i} disabled={panel.disabled} panel={
                    renderPanel(panel, i)
                } panelClassName={className} title={typeof panel.title === 'string' ? toTitleCase(panel.title) : panel.title} />
            ))}
        </Tabs>
    }

    return  <PanelGroup className={"editorSplitContainer"} direction="horizontal" autoSaveId={"tpEditorWindowPanelsRoot"}>
        <Panel
            ref={panelRefs.left}
            defaultSize={20}
            collapsible={true}
            minSize={10}
            maxSize={50}
            id={"left-panel"}
            order={-1}
            onCollapse={triggerUpdate}
            onExpand={triggerUpdate}
        >
            {renderPanels(panels.left, false, {selectedTabId: selectedLeftTabId, onChange: onLeftTabChange})}
        </Panel>
        <PanelResizeHandle className={"window-panes-separator"} />
        <Panel
            id={"center-panel"}
            order={0}
        >
                <PanelGroup direction="vertical" autoSaveId={"tpEditorWindowPanelsCenter"}>
                    <Panel
                        id={"center-top-panel"}
                        order={0}
                        className="center-top-panel"
                    >
                        {renderPanels(panels.center, false, {selectedTabId: selectedCenterTabId, onChange: onCenterTabChange})}
                        <InteractionControlsButtonGroup key="interaction-controls" />
                        <EditPreviewButtonGroup key="editpreview" isExpanded={isExpanded} toggleExpand={toggleExpand} />
                        <PopupDialogCard/>
                        <WindowPanelFlap
                            isCollapsed={panelRefs.left.current?.isCollapsed() ?? false}
                            onClick={() => togglePanel('left')}
                            position="left"
                        />
                        <WindowPanelFlap
                            isCollapsed={panelRefs.right.current?.isCollapsed() ?? false}
                            onClick={() => togglePanel('right')}
                            position="right"
                        />
                        {panels.bottom && (
                            <WindowPanelFlap
                                isCollapsed={panelRefs.bottom.current?.isCollapsed() ?? false}
                                onClick={() => togglePanel('bottom')}
                                position="bottom"
                            />
                        )}
                    </Panel>
                    {panels.bottom && <>
                    <PanelResizeHandle className={"window-panes-separator"} />
                    <Panel
                        ref={panelRefs.bottom}
                        defaultSize={10}
                        collapsible={true}
                        minSize={10}
                        maxSize={50}
                        id={"center-bottom-panel"}
                        order={1}
                        onCollapse={triggerUpdate}
                        onExpand={triggerUpdate}
                    >
                        {renderPanels(panels.bottom, true)}
                    </Panel>
                    </>}
                </PanelGroup>
        </Panel>
        <PanelResizeHandle className={"window-panes-separator"} />
        <Panel
            ref={panelRefs.right}
            defaultSize={20}
            collapsible={true}
            minSize={10}
            maxSize={50}
            id={"right-panel"}
            order={1}
            onCollapse={triggerUpdate}
            onExpand={triggerUpdate}
        >
            {renderPanels(panels.right)}
        </Panel>
    </PanelGroup>
}
