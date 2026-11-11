import pty
import os
import sys
import time
import select

def run_ssh(host, user, password, cmd):
    # Spawn ssh process with pseudo-terminal
    pid, fd = pty.fork()
    if pid == 0:
        # Child process
        os.execvp("ssh", ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", f"{user}@{host}", cmd])
    else:
        # Parent process
        output = b""
        password_sent = False
        while True:
            r, _, _ = select.select([fd], [], [], 2)
            if not r:
                res = os.waitpid(pid, os.WNOHANG)
                if res != (0, 0):
                    break
                continue
            try:
                data = os.read(fd, 1024)
            except OSError:
                break
            if not data:
                break
            output += data
            if not password_sent and (b"password:" in output.lower() or b"password" in output.lower()):
                time.sleep(0.1)
                os.write(fd, password.encode() + b"\n")
                password_sent = True
        
        os.waitpid(pid, 0)
        return output.decode(errors="replace")

if __name__ == "__main__":
    host = sys.argv[1]
    user = sys.argv[2]
    pwd = sys.argv[3]
    cmd = sys.argv[4] if len(sys.argv) > 4 else "uptime"
    res = run_ssh(host, user, pwd, cmd)
    print(res)
