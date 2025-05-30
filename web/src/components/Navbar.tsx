import { useRouter } from 'next/router';
import Cookies from 'js-cookie';
import Link from 'next/link';
import { fetchWithAuth } from '@/utils/client/tokenManager';

const Navbar = () => {
  const router = useRouter();

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();
    await fetchWithAuth('/api/logout', {
      method: 'POST',
    });
    Cookies.remove('siteAuth', { path: '/' });
    router.push('/login');
  };

  return (
    <nav>
      <ul>
        <li>
          <Link href="/">
            <a>Ask</a>
          </Link>
        </li>
        <li>
          <Link href="/answers">
            <a>All&nbsp;Answers</a>
          </Link>
        </li>
        <li>
          <Link href="/help">
            <a>Help</a>
          </Link>
        </li>
        <li>
          <a href="#" onClick={handleLogout}>
            Logout
          </a>
        </li>
      </ul>
    </nav>
  );
};

export default Navbar;
