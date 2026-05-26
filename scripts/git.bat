@echo off
set "GIT_DIR=%LOCALAPPDATA%\FSERP-github\.git"
set "WORK_TREE=D:/ITProjects/FSERP"
set "PATH=C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files\GitHub CLI;%PATH%"
"C:\Program Files\Git\cmd\git.exe" --git-dir="%GIT_DIR%" --work-tree="%WORK_TREE%" -c user.name=hkabir845 -c user.email=62505027+hkabir845@users.noreply.github.com %*
