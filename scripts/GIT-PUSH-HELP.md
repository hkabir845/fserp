# If `git push origin main` does not work

## 1. Git not found

Open a **new** terminal, then:

```powershell
$env:Path = "C:\Program Files\Git\cmd;C:\Program Files\Git\bin;$env:Path"
cd D:\ITProjects\FSERP
```

## 2. Nothing to push

You must **commit** before push:

```powershell
git add .
git commit -m "Update"
git push origin main
```

If Git says **"Everything up-to-date"**, push worked — GitHub already has your commits.

## 3. GitHub login required (most common)

```powershell
gh auth login
```

- GitHub.com  
- HTTPS  
- Login with browser  

Then:

```powershell
cd D:\ITProjects\FSERP
git push origin main
```

A browser or credential window may open — sign in as **hkabir845**.

## 4. Typo

Use **`origin`** (one `n`), not `originn`.

## 5. Helper script

```powershell
powershell -ExecutionPolicy Bypass -File D:\ITProjects\FSERP\scripts\git-push.ps1
```
