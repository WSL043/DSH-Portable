param([Parameter(Mandatory = $true)][int]$TargetProcessId)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ResizeBorderProbe {
    public delegate bool Visitor(IntPtr window, IntPtr state);
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; public Point(int x,int y) { X=x; Y=y; } }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
    [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visitor, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr window, ref Point point);
    [DllImport("user32.dll")] static extern IntPtr ChildWindowFromPointEx(IntPtr window, Point point, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    public static int Verify(int process) {
        IntPtr root=IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr unused) {
            uint owner; GetWindowThreadProcessId(window,out owner);
            if(owner==process && IsWindowVisible(window)) { root=window; return false; } return true;
        },IntPtr.Zero);
        if(root==IntPtr.Zero) throw new Exception("No native window found");
        Rect r; GetClientRect(root,out r);
        int w=r.Right, h=r.Bottom;
        int[,] cases={{1,h/2,10},{w-2,h/2,11},{w/2,1,12},{w/2,h-2,15},
            {1,1,13},{w-2,1,14},{1,h-2,16},{w-2,h-2,17}};
        for(int i=0;i<8;i++) {
            Point screen=new Point(cases[i,0],cases[i,1]); ClientToScreen(root,ref screen);
            IntPtr leaf=root;
            for(int depth=0;depth<20;depth++) {
                Point local=screen; ScreenToClient(leaf,ref local);
                IntPtr child=ChildWindowFromPointEx(leaf,local,3);
                if(child==IntPtr.Zero || child==leaf) break;
                leaf=child;
            }
            IntPtr packed=new IntPtr(unchecked((int)((screen.X & 65535)|((screen.Y & 65535)<<16))));
            int hit=0;
            // Transparent border controls must yield to the owning frame.
            for(int depth=0;depth<20 && leaf!=IntPtr.Zero;depth++) {
                hit=SendMessage(leaf,0x84,IntPtr.Zero,packed).ToInt32();
                if(hit!=-1) break;
                leaf=GetParent(leaf);
            }
            if(leaf!=root || hit!=cases[i,2]) throw new Exception("Resize edge "+i+" intercepted: hit="+hit);
        }
        return 8;
    }
}
'@
$Count = [ResizeBorderProbe]::Verify($TargetProcessId)
Write-Output "Native resize border: $Count edges/corners passed without desktop input."
