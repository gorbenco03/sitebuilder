Reproducere pentru constatarea "node bot/test/*.test.js" (fara --test) nu ruleaza toate fisierele.
Comenzi rulate (in acest folder, fisiere jucarie identice ca forma cu bot/test/*.test.js):

  node a.test.js b.test.js          -> doar a.test.js ruleaza; b.test.js ajunge doar in process.argv (niciodata executat)
  node --test a.test.js b.test.js   -> ambele ruleaza, raport TAP normal

Concluzie: comanda documentata in README.md ("node bot/test/*.test.js") si AGENTS.md/LAUNCH.md
sufera de acelasi defect mecanic: shell-ul expandeaza glob-ul in bot/test/*.test.js -> node primeste
139 fisiere ca argumente, dar executa DOAR primul alfabetic ca modul principal; restul de 138 devin
strings in process.argv, niciodata rulate, fara nicio eroare vizibila. Comanda corecta, folosita
de fapt in PROJECT_STATUS.md, este "node --test bot/test/*.test.js".
